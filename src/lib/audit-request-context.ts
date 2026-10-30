import { AsyncLocalStorage } from "node:async_hooks";
export const auditRequestContext = new AsyncLocalStorage<{relatedEventId:string|null}>();
export function linkAuditEvent(eventId:string){const context=auditRequestContext.getStore();if(context)context.relatedEventId=eventId;}
