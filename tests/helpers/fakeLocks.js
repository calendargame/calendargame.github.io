// tests/helpers/fakeLocks.js — A WEB LOCKS MANAGER FOR SEVERAL DOCUMENTS OF ONE ORIGIN, in one test realm
// (store/amnesicClose's close detection; design-amnesic-close.md 2).
//
// What it models of the real one (the Web Locks API, as measured in real Chromium and WebKit by the design's
// locks/probe.mjs): one named lock, held SHARED by any number of documents or EXCLUSIVELY by one; requests
// granted in the order they were made (a shared request waits behind an exclusive one held or queued ahead of
// it); `ifAvailable` answers at once - the callback gets null when the lock cannot be granted now; a lock is
// let go when its callback's promise settles; and a DOCUMENT DESTROYED (`close`) lets go of everything it
// holds and drops what it was waiting for, with no event to anyone - which is the whole reason the app uses
// locks to see a close. Each document asks through its own handle (`forDoc`), which a test puts on
// navigator.locks before that document's boot runs.

export function fakeLockManager() {
  const held = [] // { doc, mode }
  const queue = [] // { doc, mode, grant }
  const fits = (mode) =>
    mode === 'shared' ? !held.some((h) => h.mode === 'exclusive') : held.length === 0
  const pump = () => {
    while (queue.length && fits(queue[0].mode)) queue.shift().grant()
  }
  const release = (h) => {
    const i = held.indexOf(h)
    if (i < 0) return
    held.splice(i, 1)
    pump()
  }
  const forDoc = (doc) => ({
    request(name, options, callback) {
      const mode = options.mode ?? 'exclusive'
      return new Promise((resolve, reject) => {
        const grant = () => {
          const h = { doc, mode }
          held.push(h)
          let result
          try {
            result = callback({ name, mode })
          } catch (error) {
            release(h)
            reject(error)
            return
          }
          Promise.resolve(result).then(
            (v) => {
              release(h)
              resolve(v)
            },
            (error) => {
              release(h)
              reject(error)
            },
          )
        }
        const now = fits(mode) && queue.length === 0
        if (now) grant()
        else if (options.ifAvailable) Promise.resolve(callback(null)).then(resolve, reject)
        else queue.push({ doc, mode, grant })
      })
    },
  })
  return {
    forDoc,
    /** Document `doc` destroyed: every lock it holds is let go, and what it waited for is dropped. */
    close(doc) {
      for (let i = held.length - 1; i >= 0; i--) if (held[i].doc === doc) held.splice(i, 1)
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].doc === doc) queue.splice(i, 1)
      pump()
    },
    /** Who holds the lock now, as `doc:mode`. */
    holders: () => held.map((h) => `${h.doc}:${h.mode}`),
  }
}
