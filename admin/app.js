import { startShell, ADMIN_MODULES } from '../assets/js/shell.js';
startShell({ app: 'admin', root: document.getElementById('root'), modules: ADMIN_MODULES, allowed: ['admin'] });
