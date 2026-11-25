import express, { NextFunction, Request, Response } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import { requireAccountMatch } from './requireAccountMatch';

/**
 * Authz matrix for requireAccountMatch.
 *
 * Each protected route declares exactly one actor field
 * (`requireAccountMatch('field')`) or a resolver for path-scoped routes. The middleware validates only that field, rejects
 * ambiguous requests that name multiple actor fields with different values,
 * and denies by default when no actor is named.
 */

const ACTOR_FIELDS = ['sourcePublicKey', 'user', 'guardian'] as const;

const OWN = Keypair.random().publicKey();
const VICTIM = Keypair.random().publicKey();

// Stand-in for jwtAuth: the bearer value is used directly as the subject.
function fakeAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const sub = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (sub) (req as unknown as { user: { sub: string } }).user = { sub };
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  const ok = (_req: Request, res: Response) => res.status(200).json({ ok: true });

  app.post('/source', requireAccountMatch('sourcePublicKey'), ok);
  app.post('/user', requireAccountMatch('user'), ok);
  app.post('/guardian', requireAccountMatch('guardian'), ok);
  // Path-scoped route: the resolver reads the account from the URL.
  app.post('/account/:publicKey', requireAccountMatch((req) => req.params.publicKey), ok);
  // Protected route that declares no actor field: must deny by default.
  app.post('/unprotected', requireAccountMatch(), ok);
  // Error handler mapping AppError status codes.
  app.use((err: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: true });
  });

  return app;
}

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

  describe('path-scoped resolver', () => {
    it('allows the authenticated account', async () => {
      const res = await request(app).post(`/account/${OWN}`).set(authHeader(OWN)).send({});
      expect(res.status).toBe(200);
    });

    it('rejects another account', async () => {
      const res = await request(app).post(`/account/${VICTIM}`).set(authHeader(OWN)).send({});
      expect(res.status).toBe(403);
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
