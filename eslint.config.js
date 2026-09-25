import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import alignAssignments from './eslint/plugins/align-assignments.mjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, 'align-assignments': alignAssignments },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'key-spacing': ['error', { align: 'value' }],
      'align-assignments/align-assignments': 'error',
      // Las excepciones permiten los espacios extra que crean la alineación:
      // key-spacing alinea los valores (Property), align-assignments alinea el
      // "=" de las declaraciones (VariableDeclarator). Sin ellas, no-multi-spaces
      // marcaría como inválida la alineación que estas reglas obligan.
      'no-multi-spaces': [
        'error',
        {
          exceptions: {
            ImportDeclaration: true,
            Property: true,
            TSPropertySignature: true,
            VariableDeclarator: true,
          },
        },
      ],
    },
  },
);