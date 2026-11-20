import { useState } from 'react';
import { displayStatus } from '../../../shared/dates';
import { Link } from 'react-router-dom';
import { Plus, ArrowUpRight, Sparkles, TriangleAlert, TrendingDown, Search } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { useApp } from '../App';
import { useData } from '../hooks/useData';
import { post, patch } from '../services/api';
import type { Risk, Flag, Recommendation } from '../types';
import {
  PageTitle,
  Panel,
  Badge,
  ErrorBox,
  Loading,
  Empty,
  Modal,
  Field,
  date,
} from '../components/ui';
import { priorities } from '../../../shared/domain';
import { tooltipStyle } from './Dashboard';
export function RisksPage() {
  const { programId, user, notify } = useApp();
  const result = useData<Risk[]>(`/risks?programId=${programId}`);
  const [selected, setSelected] = useState<Risk>();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const canEdit = ['ADMIN', 'COORDINATOR', 'ANALYST'].includes(user.role);
  return (
    <>
      <PageTitle
        eyebrow="ВИМІРЮВАНИЙ ВПЛИВ"
        title="Корупційні ризики"
        description="Відстежуйте фактичну зміну показників окремо від виконання заходів."
        action={
          canEdit && (
            <button onClick={() => setCreating(true)}>
              <Plus size={18} />
              Додати ризик
            </button>
          )
        }
      />
      <div className="info-banner">
        <TrendingDown size={20} />
        <span>
          Покращення підтверджується зміною виміряного показника. Оцінка не визначає винуватість і
          не є рейтингом працівників.
        </span>
      </div>
      <div className="search standalone">
        <Search size={18} />
        <input
          placeholder="Знайти ризик…"
          aria-label="Пошук ризику"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ErrorBox message={result.error} />
      {result.loading ? (
        <Loading />
      ) : (
        <div className="risk-grid">
          {result.data
            ?.filter((r) => `${r.code} ${r.title}`.toLowerCase().includes(search.toLowerCase()))
            .map((r) => {
              const improved =
                r.direction === 'DOWN' ? r.current < r.baseline : r.current > r.baseline;
              return (
                <Panel key={r.id}>
                  <div className="panel-heading">
                    <span className="eyebrow">{r.code}</span>
                    <span className={`badge ${improved ? 'badge-completed' : 'badge-high'}`}>
                      {improved ? 'Показник покращився' : 'Без покращення'}
                    </span>
                  </div>
                  <h2>{r.title}</h2>
                  <p>{r.indicator}</p>
                  <div className="risk-numbers">
                    <div>
                      <small>Початкове</small>
                      <strong>{r.baseline}</strong>
                    </div>
                    <span>→</span>
                    <div>
                      <small>Поточне</small>
                      <strong className={improved ? 'text-green' : 'text-amber'}>
                        {r.current}
                      </strong>
                    </div>
                    <div>
                      <small>Цільове</small>
                      <strong>{r.target}</strong>
                    </div>
                  </div>
                  <div className="mini-chart">
                    <ResponsiveContainer>
                      <LineChart data={r.measurements.map((m) => ({ ...m, date: date(m.date) }))}>
                        <CartesianGrid stroke="#253249" vertical={false} />
                        <XAxis dataKey="date" stroke="#8493aa" fontSize={10} />
                        <YAxis domain={['auto', 'auto']} hide />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line
                          dataKey="value"
                          name="Показник ризику"
                          stroke={improved ? '#39cfaa' : '#efbf62'}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card-bottom">
                    <small>
                      {r.activities.length} пов’язаних заходів · {date(r.assessedAt)}
                    </small>
                    <button className="link-button" onClick={() => setSelected(r)}>
                      Детальніше <ArrowUpRight size={16} />
                    </button>
                  </div>
                </Panel>
              );
            })}
        </div>
      )}
      {result.data?.length === 0 && <Empty>Додайте перший ризик для цієї програми.</Empty>}
      {creating && (
        <RiskForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            result.reload();
          }}
        />
      )}{' '}
      {selected && (
        <Modal
          title={`${selected.code} · ${selected.title}`}
          onClose={() => setSelected(undefined)}
        >
          <p>{selected.description}</p>
          <dl>
            <dt>Причини</dt>
            <dd>{selected.causes}</dd>
            <dt>Можливі наслідки</dt>
            <dd>{selected.consequences}</dd>
            <dt>Напрям покращення</dt>
            <dd>
              {selected.direction === 'DOWN' ? 'Зменшення показника' : 'Збільшення показника'}
            </dd>
          </dl>
          <h3>Пов’язані заходи</h3>
          {selected.activities.map((a) => (
            <Link key={a.id} className="list-link" to={`/activities/${a.id}`}>
              {a.code} · {a.title}
              <Badge value={displayStatus(a)} />
            </Link>
          ))}
          <h3>Історія вимірювань</h3>
          {selected.measurements.map((m) => (
            <div className="measurement" key={m.id}>
              <strong>{m.value}</strong>
              <span>
                {m.note}
                <small>
                  {date(m.date)} · {m.author}
                </small>
              </span>
            </div>
          ))}
          {canEdit && (
            <MeasurementForm
              risk={selected}
              onSaved={() => {
                notify('Вимірювання збережено. Аналіз оновлено.');
                setSelected(undefined);
                result.reload();
              }}
            />
          )}
        </Modal>
      )}
    </>
  );
}
function RiskForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { programId } = useApp();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Новий корупційний ризик" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await post('/risks', {
              ...Object.fromEntries(f),
              programId,
              baseline: Number(f.get('baseline')),
              current: Number(f.get('current')),
              target: Number(f.get('target')),
            });
            onSaved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBox message={error} />
        <Field label="Назва ризику">
          <input name="title" minLength={5} required />
        </Field>
        <Field label="Опис">
          <textarea name="description" required />
        </Field>
        <Field label="Причини виникнення">
          <textarea name="causes" required />
        </Field>
        <Field label="Можливі наслідки">
          <textarea name="consequences" required />
        </Field>
        <Field label="Індикатор ризику">
          <input name="indicator" minLength={3} required />
        </Field>
        <div className="form-grid">
          {[
            ['baseline', 'Початкове значення'],
            ['current', 'Поточне значення'],
            ['target', 'Цільове значення'],
          ].map(([name, label]) => (
            <Field label={label} key={name}>
              <input name={name} type="number" step="any" required />
            </Field>
          ))}
          <Field label="Напрям покращення">
            <select name="direction">
              <option value="DOWN">Зменшення</option>
              <option value="UP">Збільшення</option>
            </select>
          </Field>
        </div>
        <button disabled={busy}>Зберегти ризик</button>
      </form>
    </Modal>
  );
}
function MeasurementForm({ risk, onSaved }: { risk: Risk; onSaved: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="measurement-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await post(`/risks/${risk.id}/measurements`, {
            value: Number(f.get('value')),
            note: f.get('note'),
          });
          onSaved();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Додати вимірювання</h3>
      <ErrorBox message={error} />
      <Field label={risk.indicator}>
        <input name="value" type="number" step="any" required />
      </Field>
      <Field label="Джерело даних та обґрунтування">
        <textarea name="note" minLength={5} required />
      </Field>
      <button disabled={busy}>Зберегти вимірювання</button>
    </form>
  );
}
export function FlagsPage() {
  const { programId, user, notify } = useApp();
  const result = useData<Flag[]>(`/flags?programId=${programId}`);
  const [priority, setPriority] = useState('');
  const [state, setState] = useState('');
  return (
    <>
      <PageTitle
        eyebrow="РАННЄ ВИЯВЛЕННЯ ПРОБЛЕМ"
        title="Сигнали ризику"
        description="Прозорі правила. Перевірені дані. Своєчасна реакція."
      />
      <div className="info-banner">
        <TriangleAlert size={20} />
        <span>
          Сигнали перераховуються після змін та щохвилини. Взяття до уваги не усуває проблему:
          сигнал зникає після виправлення даних.
        </span>
      </div>
      <div className="filters">
        <select
          aria-label="Пріоритет сигналу"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="">Усі пріоритети</option>
          {Object.entries(priorities).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select aria-label="Стан сигналу" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">Усі стани</option>
          <option value="OPEN">Нові</option>
          <option value="IN_REVIEW">Опрацьовуються</option>
          <option value="ACKNOWLEDGED">Взято до уваги</option>
        </select>
      </div>
      <ErrorBox message={result.error} />
      {result.loading ? (
        <Loading />
      ) : (
        <div className="signal-grid">
          {result.data
            ?.filter(
              (f) => (!priority || f.priority === priority) && (!state || f.status === state),
            )
            .map((f) => (
              <Panel key={f.id}>
                <div className="panel-heading">
                  <Badge value={f.priority} />
                  <Badge value={f.status} />
                </div>
                <h2>{f.title}</h2>
                <Link className="text-link" to={`/activities/${f.activity.id}`}>
                  {f.activity.code} · {f.activity.title} <ArrowUpRight size={14} />
                </Link>
                <p>{f.reason}</p>
                <div className="recommendation-action">
                  <strong>Рекомендована дія</strong>
                  <p>{f.action}</p>
                </div>
                <div className="card-bottom">
                  <small>
                    Виявлено {date(f.detectedAt)} · {f.rule}
                  </small>
                  {['ADMIN', 'COORDINATOR', 'MANAGER'].includes(user.role) && (
                    <select
                      aria-label={`Статус сигналу ${f.title}`}
                      value={f.status}
                      onChange={async (e) => {
                        try {
                          await patch(`/flags/${f.id}`, { status: e.target.value });
                          result.reload();
                          notify('Статус опрацювання збережено.');
                        } catch (err) {
                          notify((err as Error).message);
                        }
                      }}
                    >
                      <option value="OPEN">Новий</option>
                      <option value="IN_REVIEW">Опрацьовується</option>
                      <option value="ACKNOWLEDGED">Взято до уваги</option>
                    </select>
                  )}
                </div>
              </Panel>
            ))}
        </div>
      )}
      {result.data?.length === 0 && <Empty>Активних сигналів немає.</Empty>}
    </>
  );
}
export function RecommendationsPage() {
  const { programId, user, notify } = useApp();
  const result = useData<Recommendation[]>(`/recommendations?programId=${programId}`);
  const [state, setState] = useState('');
  const [busy, setBusy] = useState('');
  const canDecide = ['ADMIN', 'COORDINATOR', 'MANAGER'].includes(user.role);
  return (
    <>
      <PageTitle
        eyebrow="ІНТЕЛЕКТУАЛЬНИЙ АНАЛІЗ"
        title="Управлінські рекомендації"
        description="Кожна рекомендація містить підставу, пояснення та конкретну дію."
      />
      <div className="analyzer-banner">
        <div className="analyzer-icon">
          <Sparkles size={28} />
        </div>
        <div>
          <h2>Від сигналу — до обґрунтованого рішення</h2>
          <p>
            Детермінований аналіз без зовнішніх AI-сервісів. Система пояснює проблему, рішення
            ухвалює людина.
          </p>
        </div>
        <span className="tag">Аналіз активний</span>
      </div>
      <div className="filters">
        <select
          aria-label="Стан рекомендації"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">Усі рекомендації</option>
          <option value="PENDING">Очікують рішення</option>
          <option value="ACCEPTED">Прийняті</option>
          <option value="REJECTED">Відхилені</option>
          <option value="DEFERRED">Відкладені</option>
        </select>
      </div>
      <ErrorBox message={result.error} />
      {result.loading ? (
        <Loading />
      ) : (
        <div className="recommendation-list">
          {result.data
            ?.filter((r) => !state || r.status === state)
            .map((r) => (
              <Panel key={r.id}>
                <div className="panel-heading">
                  <div className="actions">
                    <Badge value={r.priority} />
                    <Badge value={r.status} />
                  </div>
                  <small>Строк розгляду: {date(r.deadline)}</small>
                </div>
                <h2>{r.problem}</h2>
                <Link className="text-link" to={`/activities/${r.activity.id}`}>
                  {r.activity.code} · {r.activity.title}
                  <ArrowUpRight size={15} />
                </Link>
                <div className="two-columns recommendation-body">
                  <div>
                    <h3>На чому ґрунтується висновок</h3>
                    <p>{r.basis}</p>
                  </div>
                  <div className="recommendation-action">
                    <h3>Запропонована дія</h3>
                    <p>{r.action}</p>
                    <small>Відповідальний: {r.responsible}</small>
                  </div>
                </div>
                {canDecide && (
                  <div className="actions">
                    {[
                      ['ACCEPTED', 'Прийняти рекомендацію'],
                      ['REJECTED', 'Відхилити'],
                      ['DEFERRED', 'Відкласти розгляд'],
                    ].map(([status, label]) => (
                      <button
                        key={status}
                        disabled={busy === r.id || r.status === status}
                        className={status === 'ACCEPTED' ? '' : 'secondary'}
                        onClick={async () => {
                          setBusy(r.id);
                          try {
                            await patch(`/recommendations/${r.id}`, { status });
                            notify('Рішення збережено в журналі дій.');
                            result.reload();
                          } catch (e) {
                            notify((e as Error).message);
                          } finally {
                            setBusy('');
                          }
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </Panel>
            ))}
        </div>
      )}
      {result.data?.length === 0 && <Empty>Наразі рекомендацій немає.</Empty>}
    </>
  );
}
