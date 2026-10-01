// Build-time-known AMD modules emitted by TypeScript; no eval, network loading, or dependency discovery.
(function () {
  const definitions = new Map(), instances = new Map();
  globalThis.define = function (name, deps, factory) {
    if (definitions.has(name)) throw new Error('Duplicate module: ' + name);
    definitions.set(name, { deps, factory });
  };
  function resolve(from, name) {
    if (!name.startsWith('.')) return name.replace(/\.js$/, '');
    const parts = from.split('/'); parts.pop();
    for (const part of name.split('/')) { if (part === '..') parts.pop(); else if (part !== '.') parts.push(part); }
    return parts.join('/').replace(/\.js$/, '');
  }
  function load(name) {
    if (instances.has(name)) return instances.get(name);
    const definition = definitions.get(name); if (!definition) throw new Error('Unknown module: ' + name);
    const exports = {}; instances.set(name, exports);
    const localRequire = function (names, fn, reject) {
      try { if (typeof names === 'string') return load(resolve(name, names)); fn(...names.map(n => load(resolve(name, n)))); }
      catch (error) { if (reject) reject(error); else throw error; }
    };
    const result = definition.factory(...definition.deps.map(dep => dep === 'exports' ? exports : dep === 'require' ? localRequire : load(resolve(name, dep))));
    if (result !== undefined) instances.set(name, result);
    return instances.get(name);
  }
  globalThis.startConvosWorkbench = function (entry) { return load(entry).start(); };
})();
