const jestJupyterLab = require('@jupyterlab/testutils/lib/jest-config');

const esModules = [
  '@codemirror',
  '@jupyter/',
  '@jupyterlab/',
  '@lumino/',
  '@marijn',
  '@microsoft',
  'color',
  'dom-serializer',
  'domelementtype',
  'domhandler',
  'domutils',
  'entities',
  'exenv-es6',
  'htmlparser2',
  'lib0',
  'marked',
  'nanoid',
  'vscode-ws-jsonrpc',
  'y-protocols',
  'y-websocket',
  'yjs'
].join('|');

const baseConfig = jestJupyterLab(__dirname);

module.exports = {
  ...baseConfig,
  automock: false,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/.ipynb_checkpoints/*'
  ],
  coverageReporters: ['lcov', 'text'],
  modulePathIgnorePatterns: [
    '<rootDir>/jupyterlab_cell_navigation_rail/labextension'
  ],
  testRegex: 'src/.*/.*.spec.ts[x]?$',
  transformIgnorePatterns: [`/node_modules/(?!${esModules}).+`]
};
