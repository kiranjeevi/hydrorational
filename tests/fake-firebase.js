// An in memory stand in for the Firebase compat SDK. It enforces the two
// things the real service would reject: a document over 1 MiB, and any
// access outside the signed in user's own users/{uid} space.
module.exports = function makeFakeFirebase() {
  const store = new Map();
  const users = {}, emailOwners = {}, sent = [], listeners = [];
  let current = null, nextUid = 1, autoId = 1;
  const LIMIT = 1048576;

  function setUser(u) { current = u; listeners.slice().forEach(f => f(u)); }
  function guard(path) {
    if (!current) throw Object.assign(new Error('permission-denied: not signed in'), {code:'permission-denied'});
    if (!path.startsWith('users/' + current.uid + '/') && path !== 'users/' + current.uid) {
      throw Object.assign(new Error('permission-denied: ' + path), {code:'permission-denied'});
    }
  }
  function makeUser(u) {
    u.linkWithCredential = function (cred) {
      const owner = emailOwners[cred.email];
      if (owner && owner !== this.uid) {
        return Promise.reject(Object.assign(new Error('credential already in use'), {code:'auth/credential-already-in-use'}));
      }
      this.isAnonymous = false; this.email = cred.email; emailOwners[cred.email] = this.uid;
      setUser(this);
      return Promise.resolve({ user: this });
    };
    return u;
  }
  const auth = {
    get currentUser() { return current; },
    onAuthStateChanged(cb) { listeners.push(cb); setTimeout(() => cb(current), 0); return () => {}; },
    signInAnonymously() {
      const u = makeUser({ uid: 'anon' + (nextUid++), isAnonymous: true, email: null });
      users[u.uid] = u; setUser(u); return Promise.resolve({ user: u });
    },
    sendSignInLinkToEmail(email, settings) { sent.push({ email, settings }); return Promise.resolve(); },
    isSignInWithEmailLink(url) { return /[?&]mode=signIn/.test(url) && /[?&]oobCode=/.test(url); },
    signInWithEmailLink(email) {
      let uid = emailOwners[email];
      if (!uid) {
        uid = 'user' + (nextUid++);
        users[uid] = makeUser({ uid, isAnonymous: false, email });
        emailOwners[email] = uid;
      }
      setUser(users[uid]); return Promise.resolve({ user: users[uid] });
    },
    signOut() { setUser(null); return Promise.resolve(); }
  };

  function snap(path) {
    const d = store.get(path);
    return { id: path.split('/').pop(), exists: !!d, data: () => d ? JSON.parse(JSON.stringify(d)) : undefined };
  }
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      collection(c) { return col(path + '/' + c); },
      set(d) {
        guard(path);
        const s = JSON.stringify(d);
        if (s.length > LIMIT) return Promise.reject(Object.assign(new Error('document exceeds 1 MiB: ' + s.length), {code:'invalid-argument'}));
        store.set(path, JSON.parse(s)); return Promise.resolve();
      },
      update(d) { guard(path); store.set(path, Object.assign({}, store.get(path) || {}, JSON.parse(JSON.stringify(d)))); return Promise.resolve(); },
      get() { try { guard(path); } catch (e) { return Promise.reject(e); } return Promise.resolve(snap(path)); },
      delete() { guard(path); store.delete(path); return Promise.resolve(); }
    };
  }
  function col(path) {
    return {
      path,
      doc(id) { return docRef(path + '/' + (id || ('auto' + (autoId++)))); },
      orderBy() { return this; },
      get() {
        try { guard(path); } catch (e) { return Promise.reject(e); }
        const pre = path + '/';
        const docs = [...store.keys()]
          .filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/'))
          .map(snap);
        return Promise.resolve({ docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) });
      }
    };
  }
  const db = {
    collection: col,
    batch() {
      const ops = [];
      return {
        set(r, d) { ops.push(() => r.set(d)); },
        delete(r) { ops.push(() => r.delete()); },
        update(r, d) { ops.push(() => r.update(d)); },
        commit() {
          // all or nothing, like the real batch
          return ops.reduce((p, f) => p.then(f), Promise.resolve());
        }
      };
    }
  };
  const fb = {
    apps: [],
    initializeApp(cfg) { const a = { cfg }; fb.apps.push(a); return a; },
    auth: Object.assign(() => auth, { EmailAuthProvider: { credentialWithLink: (email, url) => ({ email, url }) } }),
    firestore: () => db
  };
  return { fb, store, sent, users, emailOwners, auth,
           get current() { return current; },
           paths: () => [...store.keys()] };
};
