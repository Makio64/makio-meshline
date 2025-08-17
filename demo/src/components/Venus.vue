<template>
	<div class="morph-ui">
		<div class="select-gender">Select your gender</div>
		<div class="buttons">
			<button :class="{ active: isMan }" @click="onMan">man</button>
			<button :class="{ active: isWoman }" @click="onWoman">woman</button>
			<button class="next" title="Continue">&gt;</button>

		</div>
	</div>
</template>

<script>
export default {
	name: 'VenusUI',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			isMan: true,
			isWoman: false,
		}
	},
	mounted() {
		this.syncState()
		this._raf = requestAnimationFrame( this.tick )
	},
	beforeUnmount() {
		cancelAnimationFrame( this._raf )
	},
	methods: {
		onMan() {
			this.api?.david?.()
			this.isMan = true
			this.isWoman = false
		},
		onWoman() {
			this.api?.venus?.()
			this.isMan = false
			this.isWoman = true
		},
		syncState() {
			const m = this.api?.morph?.value ?? 0
			this.isWoman = m >= 0.5
			this.isMan = !this.isWoman
		},
	},
	created() {
		this.tick = () => {
			this.syncState()
			this._raf = requestAnimationFrame( this.tick )
		}
	}
}
</script>

<style lang="stylus" scoped>
.morph-ui
	position fixed
	bottom 20px
	display flex
	flex-direction column
	max-width 180px
	margin auto
	gap 12px
	padding 10px 12px
	border-radius 12px
	background rgba(20, 20, 24, .6)
	border 1px solid rgba(255, 255, 255, .12)
	backdrop-filter blur(8px)
	-webkit-backdrop-filter blur(8px)
	z-index 1000
	align-items center
	font 500 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif
	letter-spacing .2px

	.buttons
		display flex
		gap 8px

	.select-gender
		color #999
	button
		appearance none
		border 0
		margin 0
		padding 8px 14px
		border-radius 10px
		background rgba(255, 255, 255, .06)
		color #fff
		cursor pointer
		transition all .2s ease
		
		&:hover
			background rgba(255, 255, 255, .12)
		
		&.active
			background linear-gradient(180deg, #b9e6ff 0%, #c7d2fe 100%)
			color #0b1020
	
	.next
		padding 8px 12px
		min-width 38px
</style>


