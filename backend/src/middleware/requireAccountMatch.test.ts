import express from 'express';
import request from 'supertest';
import { requireAccountMatch } from './requireAccountMatch';

/**
 * Authz matrix for requireAccountMatch.
 *
 * Each protected route declares exactly one actor field via route metadata
 * (`res.locals.actorField`). The middleware validates only that field, rejects
 * ambiguous requests that name multiple actor fields with different values,
 * and denies by default when no actor is named.
 */

const ACTOR_FIELDS = ['sourcePublicKey', 'user', 'guardian'] as const;

function buildApp() {
  const app = express();
  app.use(express.json());

  // Route that declares `sourcePublicKey` as its actor field.
  app.post(
    '/source',
    (_req, res, next) => {
      res.locals.actorField = 'sourcePublicKey';
      next();
    },
    requireAccountMatch,
    (_req, res) => res.status(200).json({ ok: true }),
  );

  // Route that declares `user` as its actor field.
  app.post(
    '/user',
    (_req, res, next) => {
      res.locals.actorField = 'user';
      next();
    },
    requireAccountMatch,
    (_req, res) => res.status(200).json({ ok: true }),
  );

  // Route that declares `guardian` as its actor field.
  app.post(
    '/guardian',
    (_req, res, next) => {
      res.locals.actorField = 'guardian';
      next();
    },
    requireAccountMatch,
    (_req, res) => res.status(200).json({ ok: true }),
  );

  // Protected route that declares no actor field: must deny by default.
  app.post('/unprotected', requireAccountMatch, (_req, res) =>
    res.status(200).json({ ok: true }),
  );

  return app;
}

const OWN = 'GOWNACCOUNT000000000000000000000000000000000000000000000000';
const VICTIM = 'GVICTIMACCOUNT00000000000000000000000000000000000000000000';

function authHeader(account: string) {
  return { Authorization: `Bearer ${account}` };
}

describe('requireAccountMatch authz matrix', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  describe('declared actor field is validated', () => {
    it.each(ACTOR_FIELDS)('allows matching %s in body', async (field) => {
      const res = await request(app)
        .post(`/${field === 'sourcePublicKey' ? 'source' : field}`)
        .set(authHeader(OWN))
        .send({ [field]: OWN });
      expect(res.status).toBe(200);
    });

    it.each(ACTOR_FIELDS)('allows matching %s in query', async (field) => {
      const res = await request(app)
        .post(`/${field === 'sourcePublicKey' ? 'source' : field}`)
        .set(authHeader(OWN))
        .query({ [field]: OWN });
      expect(res.status).toBe(200);
    });

    it.each(ACTOR_FIELDS)('rejects mismatched %s', async (field) => {
      const res = await request(app)
        .post(`/${field === 'sourcePublicKey' ? 'source' : field}`)
        .set(authHeader(OWN))
        .send({ [field]: VICTIM });
      expect(res.status).toBe(403);
    });
  });

  describe('ambiguous requests', () => {
    it('rejects own sourcePublicKey with victim user', async () => {
      const res = await request(app)
        .post('/source')
        .set(authHeader(OWN))
        .send({ sourcePublicKey: OWN, user: VICTIM });
      expect(res.status).toBe(403);
    });

    it('rejects own user with victim guardian', async () => {
      const res = await request(app)
        .post('/user')
        .set(authHeader(OWN))
        .send({ user: OWN, guardian: VICTIM });
      expect(res.status).toBe(403);
    });

    it('allows multiple actor fields when they agree', async () => {
      const res = await request(app)
        .post('/source')
        .set(authHeader(OWN))
        .send({ sourcePublicKey: OWN, user: OWN });
      expect(res.status).toBe(200);
    });
  });

  describe('deny by default', () => {
    it('rejects a protected route that names no actor', async () => {
      const res = await request(app).post('/unprotected').set(authHeader(OWN)).send({});
      expect([400, 403]).toContain(res.status);
    });

    it('rejects a declared route that names no actor', async () => {
      const res = await request(app).post('/source').set(authHeader(OWN)).send({});
      expect([400, 403]).toContain(res.status);
    });
  });
});
