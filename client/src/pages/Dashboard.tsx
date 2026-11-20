import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  ArrowRight,
  CheckCheck,
  Clock3,
  TriangleAlert,
  ListChecks,
  Radar,
  TrendingDown,
  CircleDot,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { useApp } from '../App';
import { useData } from '../hooks/useData';
import type { Dashboard } from '../types';
import { PageTitle, Panel, Loading, ErrorBox, Badge, date, Empty } from '../components/ui';
const colors = ['#8a9bb7', '#3b9bff', '#c095f3', '#39cfaa', '#ff727e', '#efbf62', '#637492'];
export const tooltipStyle = {
  background: '#162236',
  border: '1px solid #30425c',
  borderRadius: 10,
  color: '#eef5ff',
};
export function DashboardPage() {
  const { programId } = useApp();
  const { data: d, loading, error } = useData<Dashboard>(`/dashboard?programId=${programId}`);
  if (loading) return <Loading />;
  if (!d) return <ErrorBox message={error} />;
  const cards = [
    {
      label: 'Усього заходів',
      value: d.total,
      icon: ListChecks,
      note: 'У поточній програмі',
      tone: 'neutral',
    },
    {
      label: 'Виконано',
      value: d.completed,
      icon: CheckCheck,
      note: `${d.progress}% усіх заходів`,
      tone: 'green',
    },
    { label: 'У процесі', value: d.inProgress, icon: Clock3, note: 'Активна робота', tone: 'blue' },
    {
      label: 'Прострочено',
      value: d.overdue,
      icon: TriangleAlert,
      note: 'Потрібне втручання',
      tone: 'red',
    },
  ];
  return (
    <>
      <PageTitle
        eyebrow="МОНІТОРИНГ У РЕАЛЬНОМУ ЧАСІ"
        title="Огляд програми"
        description="Цілісна картина виконання. Фокус на результаті та зниженні ризиків."
        action={
          <Link className="button secondary" to="/activities">
            До реєстру заходів <ArrowUpRight size={17} />
          </Link>
        }
      />
      <div className="overview-banner">
        <div>
          <span className="live-dot" /> Оперативний стан програми
        </div>
        <span>
          Оновлено з бази даних ·{' '}
          {new Date().toLocaleDateString('uk-UA', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </span>
      </div>
      <div className="kpi-grid">
        {cards.map((c) => (
          <Link
            to={`/activities${c.tone === 'green' ? '?status=COMPLETED' : c.tone === 'blue' ? '?status=IN_PROGRESS' : ''}`}
            className={`kpi ${c.tone}`}
            key={c.label}
          >
            <div className="kpi-top">
              <span>{c.label}</span>
              <c.icon size={19} />
            </div>
            <strong>{c.value.toString().padStart(2, '0')}</strong>
            <small>
              <span className="small-dot" />
              {c.note}
            </small>
            <div className="kpi-line" />
          </Link>
        ))}
      </div>
      <div className="dashboard-primary">
        <Panel className="progress-panel">
          <div className="panel-heading">
            <div>
              <h2>Прогрес реалізації</h2>
              <p>Факт виконання заходів програми</p>
            </div>
            <span className="tag">Уся програма</span>
          </div>
          <div className="progress-body">
            <div
              className="progress-ring"
              style={{ background: `conic-gradient(#38d4b1 ${d.progress}%, #263449 0)` }}
            >
              <div>
                <strong>
                  {d.progress}
                  <span>%</span>
                </strong>
                <small>виконано</small>
              </div>
            </div>
            <div className="progress-stats">
              <div>
                <span className="dot green" />
                Завершені<strong>{d.completed}</strong>
              </div>
              <div>
                <span className="dot blue" />У роботі<strong>{d.inProgress}</strong>
              </div>
              <div>
                <span className="dot red" />
                Прострочені<strong>{d.overdue}</strong>
              </div>
            </div>
          </div>
          <div className="insight">
            <CircleDot size={16} />
            <span>
              Виконання заходу ≠ зниження ризику.
              <br />
              Оцінюйте фактичну зміну показників.
            </span>
          </div>
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <h2>Динаміка виконання</h2>
              <p>Фактичні завершення та заплановані строки</p>
            </div>
            <span className="tag">6 місяців</span>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.monthly}>
                <defs>
                  <linearGradient id="completion" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#39cfaa" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#39cfaa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#263249" vertical={false} />
                <XAxis dataKey="month" stroke="#8391a9" tickLine={false} axisLine={false} />
                <YAxis
                  allowDecimals={false}
                  stroke="#8391a9"
                  tickLine={false}
                  axisLine={false}
                  width={30}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="planned"
                  name="Заплановано"
                  stroke="#647795"
                  fill="transparent"
                  strokeDasharray="5 5"
                />
                <Area
                  type="monotone"
                  dataKey="completed"
                  name="Виконано"
                  stroke="#39cfaa"
                  strokeWidth={3}
                  fill="url(#completion)"
                />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <div className="risk-summary">
        <div>
          <span className="summary-icon">
            <Radar />
          </span>
          <div>
            <small>Корупційні ризики</small>
            <strong>
              {d.riskCount} <span>під контролем</span>
            </strong>
          </div>
        </div>
        <div>
          <span className="summary-icon green">
            <TrendingDown />
          </span>
          <div>
            <small>Покращення показників</small>
            <strong>
              {d.improved} <span>із {d.riskCount} ризиків</span>
            </strong>
          </div>
        </div>
        <div>
          <span className="summary-icon amber">
            <TriangleAlert />
          </span>
          <div>
            <small>Потребують уваги</small>
            <strong>
              {d.attention} <span>заходів із сигналами</span>
            </strong>
          </div>
        </div>
        <Link to="/risks">
          Аналіз ризиків <ArrowUpRight size={18} />
        </Link>
      </div>
      <div className="two-columns">
        <Panel>
          <div className="panel-heading">
            <div>
              <h2>
                <span className="dot red" />
                Потребують управлінської уваги
              </h2>
              <p>Пояснювані сигнали на основі поточних даних</p>
            </div>
            <Link to="/flags" className="text-link">
              Усі сигнали <ArrowRight size={15} />
            </Link>
          </div>
          {d.attentionItems.length ? (
            d.attentionItems.map((a) => (
              <Link to={`/activities/${a.id}`} className="attention-row" key={a.id}>
                <div>
                  <small>
                    {a.code} · {a.department}
                  </small>
                  <strong>{a.title}</strong>
                  <span>{a.flags[0]?.title}</span>
                </div>
                <Badge
                  value={a.flags.some((f) => f.priority === 'CRITICAL') ? 'CRITICAL' : 'HIGH'}
                />
              </Link>
            ))
          ) : (
            <Empty>Активних сигналів ризику немає.</Empty>
          )}
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <h2>Найближчі контрольні строки</h2>
              <p>Незавершені заходи, впорядковані за строком</p>
            </div>
            <Link to="/calendar" className="text-link">
              Календар <ArrowRight size={15} />
            </Link>
          </div>
          {d.deadlines.map((a) => (
            <Link className="deadline-row" to={`/activities/${a.id}`} key={a.id}>
              <div className={`date-box ${new Date(a.deadline) < new Date() ? 'late' : ''}`}>
                <strong>{new Date(a.deadline).getDate()}</strong>
                <small>
                  {new Date(a.deadline).toLocaleDateString('uk-UA', { month: 'short' })}
                </small>
              </div>
              <div>
                <strong>{a.title}</strong>
                <small>
                  {a.executor.name} · {date(a.deadline)}
                </small>
              </div>
              <ArrowUpRight size={17} />
            </Link>
          ))}
        </Panel>
      </div>
      <div className="three-columns">
        <Panel title="Розподіл за статусами">
          <div className="chart">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={d.statusDistribution.filter((s) => s.value)}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={4}
                >
                  {d.statusDistribution
                    .filter((s) => s.value)
                    .map((s, i) => (
                      <Cell key={s.name} fill={colors[i % colors.length]} />
                    ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconSize={8} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Виконання за напрямами">
          <div className="direction-list">
            {d.sections.map((s) => (
              <div key={s.name}>
                <div>
                  <span>{s.name}</span>
                  <strong>
                    {s.completed}/{s.total}
                  </strong>
                </div>
                <div className="track">
                  <i style={{ width: `${s.total ? (s.completed / s.total) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Зміна показників ризиків">
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={d.risks.slice(0, 5)}>
                <CartesianGrid stroke="#263249" vertical={false} />
                <XAxis dataKey="code" stroke="#8391a9" fontSize={10} />
                <YAxis stroke="#8391a9" width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="baseline" name="Початкове" fill="#405473" radius={[4, 4, 0, 0]} />
                <Bar dataKey="current" name="Поточне" fill="#39cfaa" radius={[4, 4, 0, 0]} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </>
  );
}
