<template>
	<a class="CodeButton" :href="href" target="_blank" rel="noopener" :title="title" aria-label="View source code">
		<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24" fill="#000000">
			<path fill="none" d="M0 0h24v24H0V0z" />
			<path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
		</svg>
	</a>
</template>

<script>
export default {
	name: 'CodeButton',
	props: {
		href: { type: String, required: true },
		title: { type: String, default: 'View source code' },
	},
}
</script>

<style lang="stylus" scoped>
.CodeButton
	position fixed
	bottom 16px
	right 16px
	width 42px
	height 42px
	display inline-flex
	align-items center
	justify-content center
	background #ffffff
	backdrop-filter blur(4px)
	border-radius 25px
	box-shadow 0 2px 10px rgba(0,0,0,.15)
	transition transform .15s ease, box-shadow .15s ease
	z-index 1000
	&:hover
		box-shadow 0 6px 18px rgba(0,0,0,.2)
	svg
		width 24px
		height 24px
</style>
