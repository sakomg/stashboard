// Removes the account so the dashboard can be set up again: for a forgotten password or a lost phone.
// On the server: docker compose run --rm stashboard src/auth-reset.ts && docker compose restart stashboard
import { deleteOwner, openDb } from './db.ts';

const removed = deleteOwner(openDb());
console.log(
  removed
    ? 'Account removed and all sessions ended. Restart the server; it will print a new setup code.'
    : 'There is no account to remove.',
);
