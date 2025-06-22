import stylistic from '@stylistic/eslint-plugin'
import stylisticJs from '@stylistic/eslint-plugin-js'
import pluginVue from 'eslint-plugin-vue'
import { FlatCompat } from "@eslint/eslintrc"

const compat = new FlatCompat()

export default [
	...pluginVue.configs['flat/recommended'],
	...compat.extends( './.eslintrc-auto-import.json' ),

	{
		files: ["**/*.js", "**/*.jsx", "**/*.cjs", "**/*.mjs", "**/*.ts", "**/*.tsx", "**/*.cts", "**/*.mts", "**/*.vue"],
		ignores: ['node_modules', 'dist', 'out', '.gitignore', 'src/renderer/auto-imports.d.ts', 'src/renderer/components.d.ts'],
		plugins: {
			'@stylistic': stylistic,
			'@stylistic/js': stylisticJs
		},
		rules: {
			'vue/require-default-prop': 'off',
			'vue/multi-word-component-names': 'off',
			'vue/order-in-components': 'off',
			'vue/singleline-html-element-content-newline': 'off',
			'vue/max-attributes-per-line': 'off',
			'vue/no-multiple-template-root': 'off',
			'vue/html-indent': ['error', 'tab'], // enforce tabs in template
			'vue/no-v-html': 'off',
			'vue/first-attribute-linebreak': 'off',
			'vue/singleline-html-element-content-newline': 'off',
			'vue/multiline-html-element-content-newline': 'off',

			'@stylistic/indent': ['error', 'tab'],
			'max-len': 'off',
			'@stylistic/js/semi': ['error', 'never'],
			'@stylistic/js/key-spacing': ['error', { "beforeColon": false, "afterColon": true }],
			'@stylistic/js/space-infix-ops': ['error', { "int32Hint": false }],
			'@stylistic/js/comma-spacing': ["error", { "before": false, "after": true }],
			'@stylistic/js/array-bracket-spacing': ["error", "never"],
			'@stylistic/space-before-blocks': ["error", "always"],
			'@stylistic/object-curly-spacing': ["error", "always"],
			'@stylistic/space-in-parens': ["error", "always"],
			"array-bracket-newline": ["error", { multiline: true, minItems: null }],
			"array-element-newline": ["error", 'consistent']
		}
	}
]
