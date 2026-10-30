import { startShell, STAFF_MODULES } from '../assets/js/shell.js';
startShell({ app: 'staff', root: document.getElementById('root'), modules: STAFF_MODULES, allowed: ['staff', 'admin'] });
