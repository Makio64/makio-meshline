import stylistic from '@stylistic/eslint-plugin'
import pluginVue from 'eslint-plugin-vue'
import { FlatCompat } from "@eslint/eslintrc"
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'

const compat = new FlatCompat()

export default [
	// Configuration for src directory (plain JavaScript)
	{
		files: ["src/**/*.js", "src/**/*.mjs"],
		ignores: ['node_modules', 'dist', 'out', 'docs/.vitepress/dist'],
		plugins: {
			'@stylistic': stylistic,
			'simple-import-sort': simpleImportSort,
			'unused-imports': unusedImports
		},
		rules: {
			'@stylistic/indent': ['error', 'tab'],
			'max-len': 'off',
			'@stylistic/semi': ['error', 'never'],
			'@stylistic/key-spacing': ['error', { "beforeColon": false, "afterColon": true }],
			'@stylistic/space-infix-ops': ['error', { "int32Hint": false }],
			'@stylistic/comma-spacing': ["error", { "before": false, "after": true }],
			'@stylistic/array-bracket-spacing': ["error", "never"],
			'@stylistic/arrow-spacing': "error",
			'@stylistic/space-before-blocks': ["error", "always"],
			'@stylistic/object-curly-spacing': ["error", "always"],
			'@stylistic/space-in-parens': ["error", "always"],
			'@stylistic/no-multiple-empty-lines': ["error", { "max": 1, "maxEOF": 0 }],
			"array-bracket-newline": ["error", { multiline: true, minItems: null }],
			"array-element-newline": ["error", 'consistent'],
			"keyword-spacing": "error",
			"simple-import-sort/imports": "error",
			"unused-imports/no-unused-imports": "error",
		}
	},
	// Configuration for demo directory (Vue files and JavaScript)
	...pluginVue.configs['flat/recommended'],
	...compat.extends('./demo/.eslintrc-auto-import.json'),
	{
		files: ["demo/**/*.js", "demo/**/*.mjs", "demo/**/*.vue"],
		ignores: ['node_modules', 'dist', 'out', 'docs/.vitepress/dist'],
		plugins: {
			'@stylistic': stylistic,
			'simple-import-sort': simpleImportSort,
			'unused-imports': unusedImports
		},
		rules: {
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

			'@stylistic/indent': ['error', 'tab'],
			'max-len': 'off',
			'@stylistic/semi': ['error', 'never'],
			'@stylistic/key-spacing': ['error', { "beforeColon": false, "afterColon": true }],
			'@stylistic/space-infix-ops': ['error', { "int32Hint": false }],
			'@stylistic/comma-spacing': ["error", { "before": false, "after": true }],
			'@stylistic/array-bracket-spacing': ["error", "never"],
			'@stylistic/arrow-spacing': "error",
			'@stylistic/space-before-blocks': ["error", "always"],
			'@stylistic/object-curly-spacing': ["error", "always"],
			'@stylistic/space-in-parens': ["error", "always"],
			'@stylistic/no-multiple-empty-lines': ["error", { "max": 1, "maxEOF": 0 }],
			"array-bracket-newline": ["error", { multiline: true, minItems: null }],
			"array-element-newline": ["error", 'consistent'],
			"keyword-spacing": "error",
			"simple-import-sort/imports": "error",
			"unused-imports/no-unused-imports": "error",
		}
	}
]
