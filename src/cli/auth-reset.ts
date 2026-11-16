import { ADMIN_ID, clearCredentials, getUser, openDb } from '../storage/index.ts';

const db = openDb();
const admin = getUser(db, ADMIN_ID);
console.log(
  admin && clearCredentials(db, ADMIN_ID)
    ? `Sign-in for ${admin.name} removed and their sessions ended. Their accounts and history stay. Restart the server and it will print a new setup code.`
    : 'There is no sign-in to remove.',
);
