import type { MessageKey } from './en.ts';

/**
 * Spanish (C9). Every key English has, with the same placeholders; written
 * by the build, not yet read by a native speaker, so worth a review before
 * anyone relies on it.
 */
export const es: Record<MessageKey, string> = {
  'nav.feed': 'Novedades',
  'nav.spaces': 'Espacios',
  'nav.meetings': 'Reuniones',
  'nav.calendar': 'Calendario',
  'nav.activity': 'Actividad',
  'nav.insights': 'Análisis',
  'nav.automations': 'Automatizaciones',
  'nav.people': 'Personas',
  'nav.boards': 'Tableros',
  'nav.docs': 'Documentos',
  'nav.noBoards': 'Todavía no hay tableros.',

  'account.language': 'Idioma',
  'account.languageLead':
    'Robis en tu idioma, con fechas, horas y números escritos como los escribe tu navegador. Lo que aún no está traducido sigue en inglés.',
  'account.languageFollow': 'Como mi navegador',

  'calendar.title': 'Calendario',
  'calendar.lead':
    'Las reuniones y fechas de entrega de este espacio de trabajo, semana a semana, en tu propia zona horaria.',
  'calendar.weekOf': 'Semana del {date}',
  'calendar.week': 'Semana {number}',
  'calendar.meetings.one': '{count} reunión',
  'calendar.meetings.other': '{count} reuniones',
  'calendar.due.one': '{count} tarea vence',
  'calendar.due.other': '{count} tareas vencen',
  'calendar.zone': 'horas en {zone}',
  'calendar.previous': 'Semana anterior',
  'calendar.next': 'Semana siguiente',
  'calendar.thisWeek': 'Esta semana',
  'calendar.today': '(hoy)',
  'calendar.unloaded': 'No se pudo cargar la semana. Inténtalo de nuevo en un momento.',
  'calendar.hours': 'La semana, hora a hora',
  'calendar.nothing': 'Nada previsto',
  'calendar.dueItem': 'Vence:',
  'calendar.noMeetings':
    'No hay reuniones esta semana. Programa una desde Reuniones y aparecerá aquí.',
  'calendar.span': '{start} a {end}',

  'spaces.title': 'Espacios',
  'spaces.lead':
    'Temas donde el equipo pregunta, responde y comparte lo que funcionó. Marca lo que te ayudó; las mejores respuestas suben.',
  'spaces.start': 'Crear un espacio',
  'spaces.startIt': 'Crear el espacio',
  'spaces.starting': 'Creando…',
  'spaces.cancel': 'Cancelar',
  'spaces.name': 'Nombre',
  'spaces.namePlaceholder': 'Ayuda informática, Revisiones de diseño, Incorporación…',
  'spaces.purpose': 'Para qué sirve',
  'spaces.purposePlaceholder': 'Una línea, para que se sepa qué preguntar aquí',
  'spaces.none': 'Todavía no hay espacios',
  'spaces.noneLead':
    'Crea uno para un tema sobre el que siempre se pregunta: ayuda informática, revisiones de diseño, cómo funcionan las cosas aquí.',
  'spaces.unloaded': 'No se pudieron cargar los espacios. Inténtalo de nuevo en un momento.',
  'spaces.failed': 'No funcionó. Inténtalo de nuevo.',
  'spaces.threads.one': '{count} hilo',
  'spaces.threads.other': '{count} hilos',
  'spaces.active': 'activo {when}',
  'spaces.helpful': 'Quién más ayuda',
  'spaces.over': 'Periodo',
  'spaces.period.week': 'Esta semana',
  'spaces.period.month': 'Este mes',
  'spaces.period.all': 'Siempre',
  'spaces.nobody':
    'Nadie todavía. Marca una respuesta como Útil y quien la escribió aparecerá aquí.',
  'spaces.topReplies': 'Las respuestas que más ayudaron',
  'spaces.helpfulCount': '{count} útiles',
  'spaces.answers.one': '{count} respuesta',
  'spaces.answers.other': '{count} respuestas',
  'spaces.theAnswer': 'la respuesta',
  'spaces.inSpace': '{name} en {space}',
  'spaces.someone': 'Alguien',
};
