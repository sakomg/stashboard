const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,31}$/u;
const MIN_PASSWORD = 12;

export const checkFilled = (message) => (value) => (value.trim() ? null : message);

export const checkLength = (max, what) => (value) =>
  value.trim().length <= max ? null : `Use ${what} of up to ${max} characters.`;

export const checkName = (value) => {
  if (!value.trim()) return 'Enter a name.';
  return NAME.test(value.trim())
    ? null
    : 'Use a name of up to 32 letters, digits, spaces, dots, dashes or underscores.';
};

export const checkNewPassword = (value) => {
  if (!value) return 'Enter a password.';
  return value.length < MIN_PASSWORD ? `Use a password of at least ${MIN_PASSWORD} characters.` : null;
};

export const checkRepeat = (form) => (value) =>
  value === form.elements.namedItem('password').value ? null : 'The two passwords are different. Type them again.';

export const checkCode = (value) =>
  /^\d{6}$/.test(value.replace(/\s/g, '')) ? null : 'Enter the six-digit code from your authenticator app.';

const watched = new WeakSet();

export function validate(form, checks, show) {
  if (!watched.has(form)) {
    watched.add(form);
    form.addEventListener('input', (event) => event.target.removeAttribute('aria-invalid'));
  }
  for (const field of form.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
  for (const [name, check] of checks) {
    const field = form.elements.namedItem(name);
    const message = check(field.value);
    if (!message) continue;
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    show(message);
    return false;
  }
  show(null);
  return true;
}
