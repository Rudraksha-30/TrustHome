/** Portfolio ("previous work" photos): who can add, who can see, and what is refused. Needs TEST_MONGO_URI. */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-123456';

const request = require('supertest');
const mongoose = require('mongoose');

const BASE_URI = process.env.TEST_MONGO_URI;
const maybe = BASE_URI ? describe : describe.skip;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(40)]);

maybe('portfolio photos', () => {
  let app;
  const ctx = {};
  const api = () => request(app);
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const reg = async (role, name, email) => (await api().post('/api/auth/register').send({ name, email, password: 'Password123', role })).body;
  const add = (token, buf, type = 'image/png', caption) => {
    const r = api().post('/api/providers/me/portfolio').set(auth(token)).set('Content-Type', type);
    if (caption) r.set('X-Caption', encodeURIComponent(caption));
    return r.send(buf);
  };

  beforeAll(async () => {
    await mongoose.connect(BASE_URI, { dbName: `sm_portfolio_${Date.now()}` });
    app = require('../src/app');
    ctx.cust = await reg('customer', 'Cara Customer', 'c@test.dev');
    ctx.pro = await reg('provider', 'Paul Pro', 'p@test.dev');
    ctx.pro2 = await reg('provider', 'Pia Pro', 'p2@test.dev');
    const res = await api().put('/api/providers/me/profile').set(auth(ctx.pro.token))
      .send({ headline: 'Plumber', categories: ['plumbing'], serviceArea: 'Jaipur', priceMin: 100, priceMax: 500 });
    ctx.profileId = res.body.profile._id;
    await api().put('/api/providers/me/profile').set(auth(ctx.pro2.token))
      .send({ headline: 'Sparky', categories: ['electrical'], serviceArea: 'Jaipur', priceMin: 100, priceMax: 500 });
    ctx.profile2 = (await api().get('/api/providers/me/profile').set(auth(ctx.pro2.token))).body.profile._id;
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  });

  test('a provider adds a photo with a caption and a customer can see it', async () => {
    const up = await add(ctx.pro.token, PNG, 'image/png', 'Kitchen tap replaced');
    expect(up.status).toBe(201);
    expect(up.body.photo.caption).toBe('Kitchen tap replaced');
    ctx.photo = up.body.photo;

    const list = await api().get(`/api/providers/${ctx.profileId}/portfolio`).set(auth(ctx.cust.token));
    expect(list.status).toBe(200);
    expect(list.body.photos).toHaveLength(1);
    const file = await api().get(list.body.photos[0].url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
  });

  test('signed-out visitors see nothing; the file address cannot be guessed', async () => {
    expect((await api().get(`/api/providers/${ctx.profileId}/portfolio`)).status).toBe(401);
    expect((await api().get(`/api/portfolio/${ctx.photo._id}/file`)).status).toBe(401);
  });

  test('refuses videos, fake images, and customers adding photos', async () => {
    expect((await add(ctx.pro.token, MP4, 'video/mp4')).status).toBe(415);
    expect((await add(ctx.pro.token, Buffer.from('<script>alert(1)</script> padding padding padding'), 'image/png')).status).toBe(415);
    expect((await add(ctx.cust.token, PNG)).status).toBe(403);
  });

  test("a provider cannot view another provider's portfolio, nor edit or delete their photos", async () => {
    expect((await api().get(`/api/providers/${ctx.profileId}/portfolio`).set(auth(ctx.pro2.token))).status).toBe(403);
    expect((await api().delete(`/api/providers/me/portfolio/${ctx.photo._id}`).set(auth(ctx.pro2.token))).status).toBe(404);
    expect((await api().patch(`/api/providers/me/portfolio/${ctx.photo._id}`).set(auth(ctx.pro2.token)).send({ caption: 'x' })).status).toBe(404);
  });

  test('caption can be changed and a photo removed', async () => {
    const edit = await api().patch(`/api/providers/me/portfolio/${ctx.photo._id}`).set(auth(ctx.pro.token)).send({ caption: 'New tap' });
    expect(edit.body.photo.caption).toBe('New tap');
    expect((await api().delete(`/api/providers/me/portfolio/${ctx.photo._id}`).set(auth(ctx.pro.token))).status).toBe(200);
    const list = await api().get(`/api/providers/${ctx.profileId}/portfolio`).set(auth(ctx.cust.token));
    expect(list.body.photos).toHaveLength(0);
  });

  test('a portfolio holds at most 12 photos', async () => {
    for (let i = 0; i < 12; i += 1) expect((await add(ctx.pro.token, PNG)).status).toBe(201);
    const over = await add(ctx.pro.token, PNG);
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/12 photos/);
  });
});
