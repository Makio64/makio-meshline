import stylistic from '@stylistic/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import pluginVue from 'eslint-plugin-vue'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'

import autoImportGlobals from './demo/.eslintrc-auto-import.json' with { type: 'json' }

const ignores = ['**/node_modules/**', '**/dist/**', '**/out/**', 'docs/.vitepress/dist/**']

const plugins = {
	'@stylistic': stylistic,
	'simple-import-sort': simpleImportSort,
	'unused-imports': unusedImports,
}

const styleRules = {
	'@stylistic/indent': ['error', 'tab'],
	'@stylistic/semi': ['error', 'never'],
	'@stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true }],
	'@stylistic/space-infix-ops': ['error', { int32Hint: false }],
	'@stylistic/comma-spacing': ['error', { before: false, after: true }],
	'@stylistic/array-bracket-spacing': ['error', 'never'],
	'@stylistic/arrow-spacing': 'error',
	'@stylistic/space-before-blocks': ['error', 'always'],
	'@stylistic/object-curly-spacing': ['error', 'always'],
	'@stylistic/space-in-parens': ['error', 'always'],
	'@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
	'array-bracket-newline': ['error', { multiline: true, minItems: null }],
	'array-element-newline': ['error', 'consistent'],
	'keyword-spacing': 'error',
	'max-len': 'off',
	'simple-import-sort/imports': 'error',
	'unused-imports/no-unused-imports': 'error',
}

const vueRules = {
	...styleRules,
	'vue/require-default-prop': 'off',
	'vue/multi-word-component-names': 'off',
	'vue/order-in-components': 'off',
	'vue/singleline-html-element-content-newline': 'off',
	'vue/max-attributes-per-line': 'off',
	'vue/no-multiple-template-root': 'off',
	'vue/html-indent': ['error', 'tab'],
	'vue/no-v-html': 'off',
	'vue/first-attribute-linebreak': 'off',
	'vue/multiline-html-element-content-newline': 'off',
}

export default [
	{ ignores },
	{
		files: ['src/**/*.js', 'src/**/*.mjs', 'examples/vanilla/**/*.js'],
		ignores,
		plugins,
		rules: styleRules,
	},
	...pluginVue.configs['flat/recommended'],
	{
		files: ['demo/**/*.js', 'demo/**/*.mjs', 'demo/**/*.vue'],
		ignores,
		languageOptions: {
			globals: autoImportGlobals.globals,
		},
		plugins,
		rules: vueRules,
	},
	{
		files: ['demo/src/demos/**/*.js'],
		rules: {
			'prefer-const': 'error',
		},
	},
	{
		files: ['examples/vue/**/*.js', 'examples/vue/**/*.vue'],
		ignores,
		plugins,
		rules: {
			...vueRules,
			'prefer-const': 'error',
		},
	},
	{
		files: ['examples/react-three-fiber/**/*.{js,jsx}'],
		ignores,
		languageOptions: {
			parserOptions: {
				ecmaFeatures: { jsx: true },
			},
		},
		plugins: {
			...plugins,
			'react-hooks': reactHooks,
		},
		rules: {
			...styleRules,
			...reactHooks.configs.flat.recommended.rules,
			'prefer-const': 'error',
		},
	},
]
