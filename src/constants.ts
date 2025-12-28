export const SOCKET_EVENTS = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  PROMPT_HISTORY_ADDED: 'prompt_history_added',
  SERVER_STATUS_CHANGED: 'server_status_changed',
  SERVERS_UPDATED: 'servers_updated',
  ACTIVE_REQUESTS_CHANGED: 'active_requests_changed',
} as const;
