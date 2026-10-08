import { createApp } from "./app";

export default {
  fetch(request, env, ctx) {
    return createApp({}).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
