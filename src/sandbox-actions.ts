import type {
  ZeishSandboxAction,
} from './zeish-sandbox-client.types';
import type { ZeishSandboxdAction } from './zeish.types';

/** Command serializer for the sandboxd desktop action wire contract. */
export function serializeSandboxAction(action: ZeishSandboxAction): ZeishSandboxdAction {
  if (action.type !== 'scroll') return action;

  return {
    type: action.type,
    ...(action.x === undefined ? {} : { x: action.x }),
    ...(action.y === undefined ? {} : { y: action.y }),
    ...(action.amount === undefined ? {} : { amount: action.amount }),
    ...(action.deltaX === undefined ? {} : { delta_x: action.deltaX }),
    ...(action.deltaY === undefined ? {} : { delta_y: action.deltaY }),
  };
}
