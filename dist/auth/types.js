"use strict";
/**
 * auth/types.ts
 *
 * Canonical type definitions for the server-client authentication and
 * authorisation subsystem (CONVENTIONS.md §5.3 – §5.6, §6.2 – §6.4).
 *
 * Design principles:
 *  - IAuthProvider: pluggable strategy (one per auth.mode)
 *  - IUserStore: pluggable persistence (JSON or DB)
 *  - AuthContext: attached to every authenticated request
 *  - Permissions / roles summed from user's explicit roles + external-auth groups
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map