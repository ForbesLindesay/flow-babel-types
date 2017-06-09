import {writeFileSync} from 'fs';
import {inspect} from 'util';
import * as types from 'babel-types';
import {sync as mkdirp} from 'mkdirp';
mkdirp(__dirname + '/../lib');

function isKeyword(n) {
  return n === 'extends' || n === 'arguments' || n === 'static';
}
function addNode(v) {
  if (v === 'null') return v;
  return v + 'Node';
}
function getTypeFromValidator(validator) {
  if (validator.type) {
    return addNode(validator.type);
  } else if (validator.oneOfNodeTypes) {
    return validator.oneOfNodeTypes.map(addNode).join(' | ');
  } else if (validator.oneOfNodeOrValueTypes) {
    return validator.oneOfNodeOrValueTypes.map(addNode).join(' | ');
  } else if (validator.oneOf) {
    return validator.oneOf.map(val => inspect(val)).join(' | ');
  } else if (validator.chainOf) {
    if (
      validator.chainOf.length === 2 &&
      validator.chainOf[0].type === 'array' &&
      validator.chainOf[1].each
    ) {
      return (
        '$ReadOnlyArray<' +
        getTypeFromValidator(validator.chainOf[1].each) +
        '>'
      );
    }
    if (
      validator.chainOf.length === 2 &&
      validator.chainOf[0].type === 'string' &&
      validator.chainOf[1].oneOf
    ) {
      return validator.chainOf[1].oneOf
        .map(val => JSON.stringify(val))
        .join(' | ');
    }
  }
  const err = new Error('Unrecognised validator type');
  err.code = 'UNEXPECTED_VALIDATOR_TYPE';
  err.validator = validator;
  throw err;
}

const customTypes = {
  ClassMethod: {
    key: `Expression`,
  },
  Identifier: {
    name: `string`,
  },
  MemberExpression: {
    property: `Expression`,
  },
  ObjectMethod: {
    key: `Expression`,
  },
  ObjectProperty: {
    key: `Expression`,
  },
};

function getType(key, field) {
  const validator = types.NODE_FIELDS[key][field].validate;
  if (customTypes[key] && customTypes[key][field]) {
    return customTypes[key][field];
  } else if (validator) {
    try {
      return getTypeFromValidator(types.NODE_FIELDS[key][field].validate);
    } catch (ex) {
      if (ex.code === 'UNEXPECTED_VALIDATOR_TYPE') {
        console.log('Unrecognised validator type for ' + key + '.' + field);
        console.dir(ex.validator, {depth: 10, colors: true});
      } else {
        throw ex;
      }
      return 'mixed';
    }
  } else {
    return 'mixed';
  }
}

const aliases = {};
const output = [`// @flow`, `// generated by src/generate-code.js`, ``];
output.push(
  `type Location = {start: {line: number, column: number}, end: {line: number, column: number}};`,
);
output.push(``);
Object.keys(types.BUILDER_KEYS).sort().forEach(key => {
  output.push(`declare class ${addNode(key)} {`);
  output.push(`  type: '${key}';`);
  output.push(`  loc: ?Location;`);
  Object.keys(types.NODE_FIELDS[key])
    .sort((fieldA, fieldB) => {
      const indexA = types.BUILDER_KEYS[key].indexOf(fieldA);
      const indexB = types.BUILDER_KEYS[key].indexOf(fieldB);
      if (indexA === indexB) return fieldA < fieldB ? -1 : 1;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    })
    .forEach(field => {
      const t = getType(key, field);
      const optional = types.NODE_FIELDS[key][field].optional ? '?' : '';
      if (field === 'static') {
        return;
      }
      output.push(`  ${field}: ${optional}${t};`);
    });
  output.push(``);

  (types.ALIAS_KEYS[key] || []).concat(['Babel']).forEach(k => {
    output.push(`  // alias: ${k}`);
    if (!aliases[k]) aliases[k] = [];
    aliases[k].push(key);
  });

  output.push(`}`);
  output.push(``);
});

Object.keys(aliases).forEach(key => {
  output.push(`type ${addNode(key)} = (`);
  aliases[key].sort().forEach(k => {
    output.push(`  | ${addNode(k)}`);
  });
  output.push(`);`);
  output.push(``);
});

output.push(
  `type JSXValueNode = JSXTextNode | JSXExpressionContainerNode | JSXSpreadChildNode | JSXElementNode;`,
);

writeFileSync(__dirname + '/../babel-nodes.js', output.join('\n'));

const bt = [`// @flow`, `// generated by src/generate-code.js`, ``];

Object.keys(aliases).sort().forEach(alias => {
  bt.push(`declare interface ${alias}Switcher<T> {`);
  aliases[alias].sort().forEach(k => {
    bt.push(`  ${k[0].toLowerCase() + k.substr(1)}(node: ${addNode(k)}): T;`);
  });
  bt.push(`}`);
  bt.push(``);
});

bt.push(`declare class BabelTypes {`);
bt.push(`  constructor(t: Object): BabelTypes;`);
// Builders
Object.keys(types.BUILDER_KEYS).sort().forEach(key => {
  bt.push(
    `  ${key[0].toLowerCase() + key.substr(1)}(${types.BUILDER_KEYS[key]
      .map(field => {
        const t = getType(key, field);
        const isOptional = !!types.NODE_FIELDS[key][field].optional;
        const hasDefault = types.NODE_FIELDS[key][field].default !== null;
        const optional = isOptional || hasDefault ? '?' : '';
        return `${isKeyword(field) ? '_' + field : field}: ${optional}${t}`;
      })
      .join(', ')}): ${addNode(key)};`,
  );
});

const allTypes = Object.keys(types.BUILDER_KEYS)
  .concat(Object.keys(aliases))
  .sort();
// isX
allTypes.forEach(key => {
  bt.push(`  is${key}(value: BabelNode, opts?: Object): boolean;`);
});
// assertX
allTypes.forEach(key => {
  bt.push(`  assert${key}(value: ${addNode(key)}, opts?: Object): mixed;`);
});
// asX
allTypes.forEach(key => {
  bt.push(
    `  as${key}(value: BabelNode, opts?: Object): ${addNode(key)} | void;`,
  );
});
// switchX
Object.keys(aliases).sort().forEach(alias => {
  bt.push(
    `  switch${alias}<T>(node: ${addNode(
      alias,
    )}, switcher: ${alias}Switcher<T>): T;`,
  );
});
bt.push(`}`);
bt.push(``);
bt.push(`export default BabelTypes;`);
bt.push(``);

writeFileSync(__dirname + '/../lib/index.js.flow', bt.join('\n'));

const implementation = [`// generated by src/generate-code.js`, ``];
implementation.push(`class BabelTypes {`);
implementation.push(`  constructor(t) {`);
implementation.push(`    this._t = t;`);
implementation.push(`  }`);
Object.keys(types.BUILDER_KEYS).sort().forEach(key => {
  const name = key[0].toLowerCase() + key.substr(1);
  implementation.push(
    `  ${name}(...args) { return this._t.${name}(...args); }`,
  );
});
allTypes.forEach(key => {
  implementation.push(
    `  is${key}(...args) { return this._t.is${key}(...args); }`,
  );
});
allTypes.forEach(key => {
  implementation.push(
    `  assert${key}(...args) { this._t.assert${key}(...args); }`,
  );
});
allTypes.forEach(key => {
  implementation.push(`  as${key}(value, ...args) {`);
  implementation.push(`    if (this.is${key}(value, ...args)) return value;`);
  implementation.push(`    else return undefined;`);
  implementation.push(`  }`);
});
// switchX
implementation.push(`  _switch(node, switcher) {`);
implementation.push(
  `    const type = node.type[0].toLowerCase() + node.type.substr(1);`,
);
implementation.push(`    return switcher[type](node);`);
implementation.push(`  }`);
Object.keys(aliases).sort().forEach(alias => {
  implementation.push(`  switch${alias}(node, switcher) {`);
  implementation.push(`    return this._switch(node, switcher);`);
  implementation.push(`  }`);
  implementation.push(`  `);
});
implementation.push(`}`);
implementation.push(``);
implementation.push(`export default BabelTypes;`);
implementation.push(``);

writeFileSync(__dirname + '/index.js', implementation.join('\n'));
