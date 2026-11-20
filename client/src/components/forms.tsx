import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { ErrorBox } from './ui';

function validationMessage(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const validity = field.validity;
  if (validity.valueMissing)
    return field instanceof HTMLInputElement && field.type === 'file'
      ? 'Оберіть файл для завантаження.'
      : 'Заповніть обов’язкове поле.';
  if (validity.typeMismatch)
    return field instanceof HTMLInputElement && field.type === 'email'
      ? 'Введіть коректну електронну адресу, наприклад name@example.com.'
      : 'Введіть коректну адресу.';
  if (validity.badInput) return 'Введіть коректне число.';
  if (validity.rangeUnderflow)
    return `Значення має бути не меншим за ${(field as HTMLInputElement).min}.`;
  if (validity.rangeOverflow)
    return `Значення має бути не більшим за ${(field as HTMLInputElement).max}.`;
  if (validity.tooShort)
    return `Введіть щонайменше ${field instanceof HTMLSelectElement ? 0 : field.minLength} символів.`;
  if (validity.tooLong) return 'Скоротіть значення поля.';
  if (validity.stepMismatch) return 'Введіть значення з допустимим кроком.';
  return 'Перевірте формат значення поля.';
}

export function Form({ children, onSubmit, onInput, ...props }: ComponentProps<'form'>) {
  const [error, setError] = useState('');
  const invalid = useRef<HTMLElement | null>(null);
  return (
    <form
      {...props}
      noValidate
      onInput={(event) => {
        setError('');
        invalid.current?.removeAttribute('aria-invalid');
        onInput?.(event);
      }}
      onSubmit={(event) => {
        const field = Array.from(event.currentTarget.elements).find(
          (element) =>
            (element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement) &&
            element.willValidate &&
            !element.validity.valid,
        ) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined;
        if (field) {
          event.preventDefault();
          const label =
            field.labels?.[0]?.querySelector('span')?.textContent ||
            field.getAttribute('aria-label');
          setError(`${label ? `${label}: ` : ''}${validationMessage(field)}`);
          invalid.current?.removeAttribute('aria-invalid');
          field.setAttribute('aria-invalid', 'true');
          invalid.current = field;
          if (field.hidden) field.parentElement?.querySelector('button')?.focus();
          else field.focus();
          return;
        }
        setError('');
        onSubmit?.(event);
      }}
    >
      <ErrorBox message={error} />
      {children}
    </form>
  );
}

export function FileInput({ onChange, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const input = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('Файл не вибрано');
  useEffect(() => {
    const form = input.current?.form;
    const reset = () => setFilename('Файл не вибрано');
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, []);
  return (
    <span className="file-picker">
      <input
        {...props}
        ref={input}
        type="file"
        hidden
        onChange={(event) => {
          setFilename(
            Array.from(event.currentTarget.files ?? [])
              .map((file) => file.name)
              .join(', ') || 'Файл не вибрано',
          );
          onChange?.(event);
        }}
      />
      <button
        type="button"
        className="secondary"
        disabled={props.disabled}
        onClick={() => input.current?.click()}
      >
        Обрати файл
      </button>
      <span aria-live="polite">{filename}</span>
    </span>
  );
}
