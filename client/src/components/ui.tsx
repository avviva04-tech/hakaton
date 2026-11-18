import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, X, LoaderCircle, Inbox } from 'lucide-react';
import { statuses, priorities } from '../../../shared/domain';
export const date = (value?: string | null) => value ? new Date(value).toLocaleDateString('uk-UA') : '—';
export const stamp = (value: string) => new Date(value).toLocaleString('uk-UA');
export function Badge({ value }: { value: string }) { const labels: Record<string, string> = { ...statuses, ...priorities, PENDING: 'Очікує рішення', ACCEPTED: 'Прийнято', REJECTED: 'Відхилено', DEFERRED: 'Відкладено', OPEN: 'Новий', IN_REVIEW: 'Опрацьовується', ACKNOWLEDGED: 'Взято до уваги' }; return <span className={`badge badge-${value.toLowerCase()}`}>{labels[value] ?? value}</span>; }
export function Empty({ children = 'За обраними умовами записів немає.' }: { children?: ReactNode }) { return <div className="empty"><Inbox size={32}/><p>{children}</p></div>; }
export function ErrorBox({ message }: { message?: string }) { return message ? <div className="error" role="alert"><AlertCircle size={18}/>{message}</div> : null; }
export function Loading() { return <div className="empty"><LoaderCircle className="spin"/>Завантаження даних…</div>; }
export function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) { return <div className="page-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>; }
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); const current = dialog.current; return () => current?.close(); }, []);
  return <dialog ref={dialog} onCancel={onClose}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Закрити" onClick={onClose}><X/></button></div>{children}</dialog>;
}
export function Confirm({ title, description, onConfirm, onClose }: { title: string; description: string; onConfirm: () => Promise<void>; onClose: () => void }) { const [busy, setBusy] = useState(false); const [error, setError] = useState(''); return <Modal title={title} onClose={onClose}><p>{description}</p><ErrorBox message={error}/><div className="form-actions"><button className="secondary" onClick={onClose}>Скасувати</button><button disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Підтвердити</button></div></Modal>; }
export function Field({ label, children }: { label: string; children: ReactNode }) { const id = useId(); return <label className="field" htmlFor={id}><span>{label}</span>{isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children}</label>; }
export function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) { return <section className={`panel ${className}`}>{title && <h2>{title}</h2>}{children}</section>; }
