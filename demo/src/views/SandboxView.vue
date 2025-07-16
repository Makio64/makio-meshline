<template>
	<div class="sandbox-view">
		<div ref="codeOutput" class="code-output">
			<div class="code-header">
				<span class="code-title">Generated Code</span>
				<button class="copy-button" @click="$emit('copy-code')">📋 Copy</button>
			</div>
			<div v-if="highlightedCode && highlightedCode !== generatedCode" class="code-content" v-html="highlightedCode" />
			<pre v-else class="code-content">{{ generatedCode }}</pre>
		</div>
	</div>
</template>

<script>
export default {
	name: 'SandboxView',
	props: {
		generatedCode: {
			type: String,
			required: true
		},
		highlightedCode: {
			type: String,
			default: ''
		}
	},
	emits: ['copy-code']
}
</script>

<style lang="stylus" scoped>
.sandbox-view
	width 100%
	height 100vh
	position relative
	font-family 'Roboto Mono', monospace

.code-output
	position fixed
	top 10px
	left 10px
	right 370px
	background rgba(0, 0, 0, 0.9)
	border 1px solid rgba(255, 255, 255, 0.1)
	border-radius 8px
	overflow hidden
	display flex
	flex-direction column
	max-width 400px

.code-header
	background rgba(255, 255, 255, 0.05)
	padding 10px 15px
	display flex
	justify-content space-between
	align-items center
	border-bottom 1px solid rgba(255, 255, 255, 0.1)

.code-title
	color white
	font-size 12px
	font-weight 600
	text-transform uppercase
	letter-spacing 0.5px

.copy-button
	background rgba(255, 255, 255, 0.1)
	border 1px solid rgba(255, 255, 255, 0.2)
	color white
	padding 4px 12px
	border-radius 4px
	cursor pointer
	font-size 12px
	transition all 0.2s ease
	&:hover
		background rgba(255, 255, 255, 0.2)
		border-color rgba(255, 255, 255, 0.3)

.code-content
	color white
	padding 15px
	font-family 'Roboto Mono', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace
	font-size 13px
	line-height 1.6
	margin 0
	overflow-x auto
	overflow-y auto
	flex 1
	text-align left
	
	// Shiki styles
	:deep(pre)
		margin 0
		padding 0
		background transparent !important
	
	:deep(code)
		font-family inherit
		font-size inherit
		line-height inherit

@media (max-width: 768px)
	.code-output
		right 20px
		bottom 10px
		left 10px
		max-height 200px
	
	.code-content
		font-size 10px
		padding 10px
</style>