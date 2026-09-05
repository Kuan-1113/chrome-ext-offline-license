/**
 * Replace publicJwk with the contents of tools/keys/public-key.json,
 * and pick your own prefix (it namespaces keys, so a key for one of your
 * extensions won't activate another).
 *
 * The public key is meant to be public — it ships inside every copy of your
 * extension. It is the PRIVATE key that must never leave your machine.
 */
const LICENSE_CONFIG = {
  publicJwk: {
    kty: 'EC',
    crv: 'P-256',
    x: 'REPLACE_ME',
    y: 'REPLACE_ME',
    ext: true,
    key_ops: ['verify']
  },
  prefix: 'app1:'
};

if (typeof self !== 'undefined') self.LICENSE_CONFIG = LICENSE_CONFIG;
