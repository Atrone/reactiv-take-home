import type { ConfigurationRepository } from "../configurations/repository.js";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Server-selected tenant from DEMO_TENANT_ID.
     * Callers cannot set this with X-Tenant-Id or a body tenantId.
     */
    tenantId: string | null;
  }

  interface FastifyInstance {
    /** Storage for create, load, and conditional update. The process entry supplies a pool. Tests may inject a spy. */
    configurationRepository: ConfigurationRepository;
  }
}
