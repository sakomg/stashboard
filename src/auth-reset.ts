import { deleteOwner, openDb } from './db.ts';

const removed = deleteOwner(openDb());
console.log(
  removed
    ? 'Account removed and all sessions ended. Restart the server and it will print a new setup code.'
    : 'There is no account to remove.',
);
