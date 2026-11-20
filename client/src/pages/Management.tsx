import { Form } from '../components/forms';
import { displayStatus, isOverdue, todayKey, dayKey } from '../../../shared/dates';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
  RotateCcw,
  Pencil,
} from 'lucide-react';
import { useApp } from '../App';
import { useData } from '../hooks/useData';
import { post, patch, download } from '../services/api';
import type { Activity, Dashboard, Evidence, Audit, User, Program } from '../types';
import { roles, departments, sections } from '../../../shared/domain';
import {
  PageTitle,
  Panel,
  ErrorBox,
  Empty,
  Loading,
  Field,
  Modal,
  Badge,
  date,
} from '../components/ui';
import { EvidenceTable, UploadForm, AuditTable } from './Activities';
export function EvidencePage() {
  const { programId, user } = useApp();
  const result = useData<Evidence[]>(`/evidence?programId=${programId}`);
  const activities = useData<{ items: Activity[] }>(
    `/activities?programId=${programId}&pageSize=100`,
  );
  const [search, setSearch] = useState('');
  const [activityId, setActivityId] = useState('');
  return (
    <>
      <PageTitle
        eyebrow="ДОКАЗОВА БАЗА"
        title="Підтвердні матеріали"
        description="Документи, історія версій та контроль цілісності SHA-256."
      />
      {['ADMIN', 'COORDINATOR', 'EXECUTOR'].includes(user.role) && (
        <Panel title="Додати документ">
          <Field label="Пов’язаний захід">
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
              <option value="">Оберіть захід</option>
              {activities.data?.items.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.title}
                </option>
              ))}
            </select>
          </Field>
          {activityId && <UploadForm activityId={activityId} onSaved={result.reload} />}
        </Panel>
      )}
      <Panel>
        <div className="search standalone">
          <Search size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук за назвою документа…"
            aria-label="Пошук документів"
          />
        </div>
        <ErrorBox message={result.error} />
        {result.loading ? (
          <Loading />
        ) : (
          <EvidenceTable
            items={
              result.data?.filter((e) => e.name.toLowerCase().includes(search.toLowerCase())) ?? []
            }
          />
        )}
      </Panel>
    </>
  );
}
export function CalendarPage() {
  const { programId } = useApp();
  const result = useData<{ items: Activity[] }>(`/calendar?programId=${programId}`);
  const users = useData<User[]>('/users');
  const [month, setMonth] = useState(new Date(todayKey().slice(0, 7) + '-01T00:00:00Z'));
  const [department, setDepartment] = useState('');
  const [executor, setExecutor] = useState('');
  const [selected, setSelected] = useState('');
  const [view, setView] = useState('all');
  const items =
    result.data?.items.filter(
      (a) =>
        (!department || a.department === department) && (!executor || a.executorId === executor),
    ) ?? [];
  const start = new Date(month);
  start.setUTCDate(1 - ((month.getUTCDay() + 6) % 7));
  const days = Array.from(
    { length: 42 },
    (_, i) =>
      new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i)),
  );
  const key = dayKey;
  const now = new Date(todayKey());
  const weekEnd = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 7 - (now.getUTCDay() || 7),
      23,
      59,
      59,
    ),
  );
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    nextMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  const visible = items
    .filter((a) => {
      const d = new Date(a.deadline);
      return (
        (!selected || key(d) === selected) &&
        (view === 'all' ||
          (view === 'overdue' && isOverdue(a.deadline, a.status, now)) ||
          (view === 'week' &&
            dayKey(d) >= todayKey(now) &&
            dayKey(d) <= weekEnd.toISOString().slice(0, 10)) ||
          (view === 'next' && d >= nextMonthStart && d < nextMonthEnd))
      );
    })
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  if (result.loading) return <Loading />;
  if (result.error) return <ErrorBox message={result.error} />;
  return (
    <>
      <PageTitle
        eyebrow="ПЛАНУВАННЯ ТА КОНТРОЛЬ"
        title="Контроль строків"
        description="Календар контрольних дат та своєчасні попередження."
      />
      <div className="filters">
        <select
          aria-label="Підрозділ календаря"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="">Усі підрозділи</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select
          aria-label="Виконавець календаря"
          value={executor}
          onChange={(e) => setExecutor(e.target.value)}
        >
          <option value="">Усі виконавці</option>
          {users.data
            ?.filter((u) => u.role === 'EXECUTOR')
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </select>
      </div>
      <ErrorBox message={result.error} />
      <Panel>
        <div className="panel-heading">
          <h2>
            <CalendarDays size={20} />{' '}
            {month.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="actions">
            <button
              className="secondary"
              aria-label="Попередній місяць"
              onClick={() =>
                setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))
              }
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="secondary"
              onClick={() => {
                setMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
                setSelected('');
              }}
            >
              Сьогодні
            </button>
            <button
              className="secondary"
              aria-label="Наступний місяць"
              onClick={() =>
                setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="calendar-grid">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((d) => (
            <div className="weekday" key={d}>
              {d}
            </div>
          ))}
          {days.map((d) => (
            <button
              className={`calendar-day ${d.getUTCMonth() !== month.getUTCMonth() ? 'outside' : ''} ${key(d) === key(now) ? 'today' : ''} ${selected === key(d) ? 'selected' : ''}`}
              key={key(d)}
              onClick={() => {
                setSelected(selected === key(d) ? '' : key(d));
                setView('all');
              }}
            >
              <span>{d.getUTCDate()}</span>
              {items
                .filter((a) => key(new Date(a.deadline)) === key(d))
                .slice(0, 2)
                .map((a) => (
                  <small
                    key={a.id}
                    className={
                      a.status === 'COMPLETED'
                        ? 'green'
                        : isOverdue(a.deadline, a.status, now)
                          ? 'red'
                          : 'blue'
                    }
                  >
                    {a.code} {a.title}
                  </small>
                ))}
              {items.filter((a) => key(new Date(a.deadline)) === key(d)).length > 2 && (
                <small>
                  Ще {items.filter((a) => key(new Date(a.deadline)) === key(d)).length - 2}
                </small>
              )}
            </button>
          ))}
        </div>
      </Panel>
      <Panel title={selected ? `Строки на ${date(selected)}` : 'Перелік контрольних строків'}>
        <div className="tabs">
          {[
            ['all', 'Усі строки'],
            ['overdue', 'Прострочені'],
            ['week', 'Цього тижня'],
            ['next', 'Наступного місяця'],
          ].map(([v, label]) => (
            <button
              key={v}
              className={view === v ? 'active' : ''}
              onClick={() => {
                setView(v);
                setSelected('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {visible.map((a) => (
          <Link className="list-link" key={a.id} to={`/activities/${a.id}`}>
            <span>
              {date(a.deadline)} · {a.title}
              <small>{a.executor.name}</small>
            </span>
            <Badge value={displayStatus(a)} />
          </Link>
        ))}
        {!visible.length && <Empty />}
      </Panel>
    </>
  );
}
type ReportRow = {
  section: string;
  sectionName: string;
  code: string;
  title: string;
  executor: string;
  actualDate: string;
  status: string;
  result: string;
};
export function ReportsPage() {
  const { programId, year, half, notify } = useApp();
  const query = new URLSearchParams({ programId, year: String(year), half: String(half) });
  const result = useData<ReportRow[]>(`/reports?${query}`);
  const [busy, setBusy] = useState('');
  return (
    <>
      <PageTitle
        eyebrow="ЗВІТНІСТЬ БЕЗ ПОВТОРНОГО ВВЕДЕННЯ"
        title="Піврічний звіт"
        description={`Попередній перегляд · ${half === 1 ? 'І' : 'ІІ'} півріччя ${year} року. Період змінюється у верхній панелі.`}
        action={
          <div className="actions">
            {['pdf', 'xlsx', 'csv'].map((format) => (
              <button
                className="secondary"
                disabled={!!busy}
                key={format}
                onClick={async () => {
                  setBusy(format);
                  try {
                    await download(
                      `/reports?${query}&format=${format}`,
                      `Звіт-${year}-${half}.${format}`,
                    );
                    notify('Звіт сформовано та завантажено.');
                  } catch (e) {
                    notify((e as Error).message);
                  } finally {
                    setBusy('');
                  }
                }}
              >
                <Download size={16} />
                {busy === format ? 'Генерація…' : format.toUpperCase()}
              </button>
            ))}
          </div>
        }
      />
      <div className="info-banner">
        <FileReportIcon />
        <span>
          Для постійних заходів фактичний строк — кінець півріччя. Дані підготовлені для ручного
          перенесення на Портал доброчесності НАЗК; прямого підключення немає.
        </span>
      </div>
      <ErrorBox message={result.error} />
      {result.loading ? (
        <Loading />
      ) : (
        Object.entries(sections).map(([key, title]) => (
          <Panel key={key} title={`РОЗДІЛ ${key}. ${title}`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Захід</th>
                    <th>Фактичний строк</th>
                    <th>Стан виконання</th>
                    <th>Результат / причини невиконання</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data
                    ?.filter((r) => r.section === key)
                    .map((r) => (
                      <tr key={r.code}>
                        <td>
                          <strong>
                            {r.code} · {r.title}
                          </strong>
                          <small>{r.executor}</small>
                        </td>
                        <td>{r.actualDate}</td>
                        <td>{r.status}</td>
                        <td>{r.result}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!result.data?.some((r) => r.section === key) && (
              <Empty>Заходів у цьому розділі за обраний період немає.</Empty>
            )}
          </Panel>
        ))
      )}
    </>
  );
}
function FileReportIcon() {
  return <Download size={20} />;
}
export function AuditPage() {
  const result = useData<Audit[]>('/audit');
  const [search, setSearch] = useState('');
  return (
    <>
      <PageTitle
        eyebrow="ПРОСТЕЖУВАНІСТЬ"
        title="Журнал дій"
        description="Останні 300 подій. Записи недоступні для редагування або видалення через систему."
      />
      <Panel>
        <div className="search standalone">
          <Search size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук за дією, користувачем або об’єктом…"
            aria-label="Пошук у журналі"
          />
        </div>
        <ErrorBox message={result.error} />
        {result.loading ? (
          <Loading />
        ) : (
          <AuditTable
            items={
              result.data?.filter((a) =>
                `${a.action} ${a.userName} ${a.objectId}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              ) ?? []
            }
          />
        )}
      </Panel>
    </>
  );
}
export function UsersPage() {
  const result = useData<User[]>('/users');
  const [editing, setEditing] = useState<User | null | undefined>();
  return (
    <>
      <PageTitle
        eyebrow="АДМІНІСТРУВАННЯ"
        title="Користувачі та доступ"
        description="П’ять ролей із перевіркою дозволів на сервері."
        action={
          <button onClick={() => setEditing(null)}>
            <Plus size={16} />
            Додати користувача
          </button>
        }
      />
      <Panel>
        <ErrorBox message={result.error} />
        {result.loading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Користувач</th>
                  <th>Роль</th>
                  <th>Підрозділ</th>
                  <th>Стан</th>
                  <th>Дії</th>
                </tr>
              </thead>
              <tbody>
                {result.data?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      <small>{u.email}</small>
                    </td>
                    <td>{roles[u.role]}</td>
                    <td>{u.department}</td>
                    <td>{u.active ? 'Активний' : 'Вимкнений'}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Редагувати ${u.name}`}
                        onClick={() => setEditing(u)}
                      >
                        <Pencil size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing !== undefined && (
        <UserForm
          user={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            result.reload();
          }}
        />
      )}
    </>
  );
}
function UserForm({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={user ? 'Редагувати користувача' : 'Додати користувача'} onClose={onClose}>
      <Form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const data = {
            ...Object.fromEntries(f),
            active: f.get('active') === 'on',
            password: f.get('password') || undefined,
          };
          setBusy(true);
          try {
            await (user ? patch(`/users/${user.id}`, data) : post('/users', data));
            onSaved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBox message={error} />
        <Field label="Ім’я">
          <input name="name" required minLength={2} defaultValue={user?.name} />
        </Field>
        <Field label="Електронна пошта">
          <input name="email" type="email" required defaultValue={user?.email} />
        </Field>
        <Field label="Роль">
          <select name="role" defaultValue={user?.role ?? 'EXECUTOR'}>
            {Object.entries(roles).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Підрозділ">
          <select name="department" defaultValue={user?.department}>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field
          label={
            user
              ? 'Новий пароль (залиште порожнім, щоб не змінювати)'
              : 'Пароль, щонайменше 10 символів'
          }
        >
          <input
            name="password"
            type="password"
            minLength={10}
            required={!user}
            autoComplete="new-password"
          />
        </Field>
        <label className="checkbox">
          <input name="active" type="checkbox" defaultChecked={user?.active ?? true} />
          Активний обліковий запис
        </label>
        <button disabled={busy}>Зберегти користувача</button>
      </Form>
    </Modal>
  );
}
export function ProgramsPage() {
  const { user, refresh } = useApp();
  const result = useData<Program[]>('/programs');
  const [editing, setEditing] = useState<Program | null | undefined>();
  const editable = ['ADMIN', 'COORDINATOR'].includes(user.role);
  return (
    <>
      <PageTitle
        eyebrow="ПРОГРАМИ УСТАНОВИ"
        title="Антикорупційні програми"
        description="Створюйте програми та керуйте їхнім життєвим циклом."
        action={
          editable && (
            <button onClick={() => setEditing(null)}>
              <Plus size={16} />
              Нова програма
            </button>
          )
        }
      />
      <ErrorBox message={result.error} />
      <div className="two-columns">
        {result.data?.map((p) => (
          <Panel key={p.id}>
            <span className="eyebrow">
              {p.year} · {p.archived ? 'АРХІВ' : 'АКТИВНА'}
            </span>
            <h2>{p.name}</h2>
            <p>{p.description}</p>
            {editable && (
              <button className="secondary" onClick={() => setEditing(p)}>
                Редагувати програму
              </button>
            )}
          </Panel>
        ))}
      </div>
      {editing !== undefined && (
        <ProgramForm
          program={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            result.reload();
            refresh();
          }}
        />
      )}
    </>
  );
}
function ProgramForm({
  program,
  onClose,
  onSaved,
}: {
  program: Program | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState('');
  return (
    <Modal title="Параметри програми" onClose={onClose}>
      <Form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const data = {
            name: f.get('name'),
            description: f.get('description'),
            year: Number(f.get('year')),
            archived: f.get('archived') === 'on',
          };
          try {
            await (program ? patch(`/programs/${program.id}`, data) : post('/programs', data));
            onSaved();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <ErrorBox message={error} />
        <Field label="Назва">
          <input name="name" required minLength={3} defaultValue={program?.name} />
        </Field>
        <Field label="Опис">
          <textarea name="description" defaultValue={program?.description} />
        </Field>
        <Field label="Рік">
          <input
            name="year"
            type="number"
            min={2020}
            max={2100}
            required
            defaultValue={program?.year ?? new Date().getFullYear()}
          />
        </Field>
        <label className="checkbox">
          <input name="archived" type="checkbox" defaultChecked={program?.archived} />
          Архівна програма
        </label>
        <button>Зберегти програму</button>
      </Form>
    </Modal>
  );
}
export function SettingsPage({ onReset }: { onReset: () => void }) {
  const result = useData<{ staleDays: number; demoMode: boolean }>('/settings');
  const { notify } = useApp();
  const [reset, setReset] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageTitle
        eyebrow="АДМІНІСТРУВАННЯ"
        title="Налаштування"
        description="Параметри контролю актуальності та демонстраційного середовища."
      />
      <ErrorBox message={result.error || error} />
      <div className="two-columns">
        <Panel title="Правила моніторингу">
          {result.data && (
            <Form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await patch('/settings', {
                    staleDays: Number(new FormData(e.currentTarget).get('staleDays')),
                  });
                  notify('Налаштування збережено.');
                  result.reload();
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <Field label="Сигнал про застарілі дані через (днів)">
                <input
                  name="staleDays"
                  type="number"
                  min={7}
                  max={180}
                  defaultValue={result.data.staleDays}
                  required
                />
              </Field>
              <p>
                Незавершений захід без оновлень протягом цього строку отримує сигнал про
                необхідність актуалізації.
              </p>
              <button>Зберегти налаштування</button>
            </Form>
          )}
        </Panel>
        <Panel title="Демонстраційні дані">
          <p>
            Відновлює початковий набір: 30 заходів, 12 ризиків, 8 виконавців і 20 записів
            документів. Поточні зміни буде втрачено. Журнал аудиту зберігається.
          </p>
          <button
            className="danger"
            disabled={!result.data?.demoMode}
            onClick={() => setReset(true)}
          >
            <RotateCcw size={17} />
            Скинути демонстраційні дані
          </button>
          <p className="muted">Режим: {result.data?.demoMode ? 'демонстраційний' : 'звичайний'}</p>
        </Panel>
      </div>
      {reset && (
        <Modal title="Скинути демонстраційні дані?" onClose={() => setReset(false)}>
          <p>Для підтвердження введіть СКИНУТИ. Сесії буде завершено.</p>
          <Form
            onSubmit={async (e) => {
              e.preventDefault();
              const confirm = new FormData(e.currentTarget).get('confirm');
              setBusy(true);
              try {
                await post('/demo/reset', { confirm });
                onReset();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ErrorBox message={error} />
            <Field label="Підтвердження">
              <input name="confirm" required pattern="СКИНУТИ" />
            </Field>
            <button className="danger" disabled={busy}>
              {busy ? 'Відновлення…' : 'Скинути дані'}
            </button>
          </Form>
        </Modal>
      )}
    </>
  );
}
