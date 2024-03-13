import { DENO_DEPLOYMENT_ID } from "./constants.ts";
import { colors } from "../server/deps.ts";
import { compose, Middleware } from "./middlewares/compose.ts";
import { createContext } from "./context.ts";
import { Method, UrlPatternRouter } from "./router.ts";
import { FreshHelpers } from "./defines.ts";

export interface App<State> extends FreshHelpers<State> {
  use(middleware: Middleware<State>): this;
  get(path: string, middleware: Middleware<State>): this;
  post(path: string, middleware: Middleware<State>): this;
  patch(path: string, middleware: Middleware<State>): this;
  put(path: string, middleware: Middleware<State>): this;
  delete(path: string, middleware: Middleware<State>): this;
  all(path: string, middleware: Middleware<State>): this;

  listen(options?: ListenOptions): Promise<void>;
}

export interface ListenOptions extends Partial<Deno.ServeTlsOptions> {
  basePath?: string;
  remoteAddress?: string;
}

export interface RouteCacheEntry<T> {
  params: Record<string, string>;
  handler: Middleware<T>;
}

// deno-lint-ignore no-explicit-any
const identityFn = (x: any) => x;

export class FreshApp<State> implements App<State> {
  router = new UrlPatternRouter<Middleware<State>>();
  #routeCache = new Map<string, RouteCacheEntry<State>>();

  defineMiddleware = identityFn;
  defineHandlers = identityFn;
  definePage = identityFn;

  use(middleware: Middleware<State>): this {
    this.router.add({ method: "ALL", path: "*", handler: middleware });
    return this;
  }

  get(path: string, handler: Middleware<State>): this {
    this.router.add({ method: "GET", path, handler });
    return this;
  }
  post(path: string, handler: Middleware<State>): this {
    this.router.add({ method: "POST", path, handler });
    return this;
  }
  patch(path: string, handler: Middleware<State>): this {
    this.router.add({ method: "PATCH", path, handler });
    return this;
  }
  put(path: string, handler: Middleware<State>): this {
    this.router.add({ method: "PUT", path, handler });
    return this;
  }
  delete(path: string, handler: Middleware<State>): this {
    this.router.add({ method: "DELETE", path, handler });
    return this;
  }

  all(path: string, handler: Middleware<State>): this {
    this.router.add({ method: "ALL", path, handler });
    return this;
  }

  handler(): (request: Request) => Promise<Response> {
    const next = () =>
      Promise.resolve(new Response("Not found", { status: 404 }));

    return async (req: Request) => {
      const url = new URL(req.url);
      // Prevent open redirect attacks
      url.pathname = url.pathname.replace(/\/+/g, "/");

      const ctx = createContext<State>(req, next);

      const cached = this.#routeCache.get(req.url);
      if (cached !== undefined) {
        ctx.params = cached.params;
        return cached.handler(ctx);
      }

      const method = req.method.toUpperCase() as Method;
      const matched = this.router.match(method, url);

      if (matched.handlers.length === 0) {
        return next();
      }

      const params = matched.params;
      ctx.params = matched.params;

      const handler = compose<State>(matched.handlers);

      this.#routeCache.set(req.url, {
        params,
        handler,
      });

      return await handler(ctx);
    };
  }

  async listen(options: ListenOptions = {}): Promise<void> {
    if (!options.onListen) {
      options.onListen = (params) => {
        const pathname = (options.basePath ?? "") + "/";
        const protocol = options.key && options.cert ? "https:" : "http:";
        const address = colors.cyan(
          `${protocol}//${params.hostname}:${params.port}${pathname}`,
        );
        const localLabel = colors.bold("Local:");

        // Print more concise output for deploy logs
        if (DENO_DEPLOYMENT_ID) {
          console.log(
            colors.bgRgb8(colors.rgb8(" 🍋 Fresh ready ", 0), 121),
            `${localLabel} ${address}`,
          );
        } else {
          console.log();
          console.log(
            colors.bgRgb8(colors.rgb8(" 🍋 Fresh ready   ", 0), 121),
          );
          const sep = options.remoteAddress ? "" : "\n";
          const space = options.remoteAddress ? " " : "";
          console.log(`    ${localLabel}  ${space}${address}${sep}`);
          if (options.remoteAddress) {
            const remoteLabel = colors.bold("Remote:");
            const remoteAddress = colors.cyan(options.remoteAddress);
            console.log(`    ${remoteLabel}  ${remoteAddress}\n`);
          }
        }
      };
    }

    await Deno.serve(options, this.handler());
  }
}

export function createApp<
  // deno-lint-ignore no-explicit-any
  State extends Record<string, any> = never,
>(): App<State> {
  return new FreshApp<State>();
}
