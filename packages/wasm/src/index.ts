import { convertIntegrationFnToClass, defineIntegration } from '@sentry/core';
import type { Event, Integration, IntegrationClass, IntegrationFn, StackFrame } from '@sentry/types';

import { patchWebAssembly } from './patchWebAssembly';
import { getImage, getImages } from './registry';

const INTEGRATION_NAME = 'Wasm';

const _wasmIntegration = (() => {
  return {
    name: INTEGRATION_NAME,
    setupOnce() {
      patchWebAssembly();
    },
    processEvent(event: Event): Event {
      let haveWasm = false;

      if (event.exception && event.exception.values) {
        event.exception.values.forEach(exception => {
          if (exception.stacktrace && exception.stacktrace.frames) {
            haveWasm = haveWasm || patchFrames(exception.stacktrace.frames);
          }
        });
      }

      if (haveWasm) {
        event.debug_meta = event.debug_meta || {};
        event.debug_meta.images = [...(event.debug_meta.images || []), ...getImages()];
      }

      return event;
    },
  };
}) satisfies IntegrationFn;

export const wasmIntegration = defineIntegration(_wasmIntegration);

/**
 * Process WASM stack traces to support server-side symbolication.
 *
 * This also hooks the WebAssembly loading browser API so that module
 * registrations are intercepted.
 *
 * @deprecated Use `wasmIntegration` export instead
 *
 * import { wasmIntegration } from '@sentry/wasm';
 *
 * ```
 * Sentry.init({ integrations: [wasmIntegration()] });
 * ```
 */
// eslint-disable-next-line deprecation/deprecation
export const Wasm = convertIntegrationFnToClass(INTEGRATION_NAME, wasmIntegration) as IntegrationClass<
  Integration & { processEvent: (event: Event) => Event }
>;

/**
 * Patches a list of stackframes with wasm data needed for server-side symbolication
 * if applicable. Returns true if any frames were patched.
 */
function patchFrames(frames: Array<StackFrame>): boolean {
  let haveWasm = false;
  frames.forEach(frame => {
    if (!frame.filename) {
      return;
    }
    const match = frame.filename.match(/^(.*?):wasm-function\[\d+\]:(0x[a-fA-F0-9]+)$/);
    if (match !== null) {
      const index = getImage(match[1]);
      if (index >= 0) {
        frame.instruction_addr = match[2];
        frame.addr_mode = `rel:${index}`;
        frame.filename = match[1];
        frame.platform = 'native';
        haveWasm = true;
      }
    }
  });
  return haveWasm;
}
