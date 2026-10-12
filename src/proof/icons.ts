import file from 'lucide-static/icons/file.svg?raw';
import folder from 'lucide-static/icons/folder.svg?raw';
import userRound from 'lucide-static/icons/user-round.svg?raw';
import calendar from 'lucide-static/icons/calendar.svg?raw';
import database from 'lucide-static/icons/database.svg?raw';
import plus from 'lucide-static/icons/plus.svg?raw';
import minus from 'lucide-static/icons/minus.svg?raw';
import check from 'lucide-static/icons/check.svg?raw';
import x from 'lucide-static/icons/x.svg?raw';
import pencil from 'lucide-static/icons/pencil.svg?raw';

export const subjects = { file, folder, 'user-round': userRound, calendar, database };
export const modifiers = { plus, minus, check, x, pencil };

export const examples = [
  { title: 'File + Add', subject: 'file', modifier: 'plus', offsetX: 0, offsetY: 0, scale: 0.45 },
  { title: 'Folder + Check', subject: 'folder', modifier: 'check', offsetX: 0, offsetY: 0, scale: 0.48 },
  { title: 'User + Remove', subject: 'user-round', modifier: 'minus', offsetX: 0, offsetY: 0, scale: 0.46 },
  { title: 'Calendar + Edit', subject: 'calendar', modifier: 'pencil', offsetX: 0, offsetY: 0, scale: 0.48 },
  { title: 'Database + Remove', subject: 'database', modifier: 'x', offsetX: 0, offsetY: 0, scale: 0.45 },
] as const;
