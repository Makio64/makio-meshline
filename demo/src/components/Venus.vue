<template>
	<div class="morph-ui">
		<div class="select-gender">Select your gender</div>
		<div class="buttons">
			<button :class="{ active: selectedGender === 'man', man: true }" @click="onMan">Man</button>
			<button :class="{ active: selectedGender === 'woman', woman: true }" @click="onWoman">Woman</button>
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
			selectedGender: 'man',
		}
	},
	mounted() {
		// Set initial state based on morph value
		const m = this.api?.morph?.value ?? 0
		this.selectedGender = m >= 0.5 ? 'woman' : 'man'
	},
	methods: {
		onMan() {
			this.selectedGender = 'man'
			this.api?.david?.()
		},
		onWoman() {
			this.selectedGender = 'woman'
			this.api?.venus?.()
		},
	},
}
</script>

<style lang="stylus" scoped>
.morph-ui
	position fixed
	bottom 40px
	display flex
	flex-direction column
	max-width 320px
	margin auto
	gap 20px
	padding 24px 28px
	border-radius 24px
	// background linear-gradient(135deg, rgba(30, 30, 40, 0.95) 0%, rgba(20, 20, 30, 0.85) 100%)
	border 1px solid transparent
	background-clip padding-box
	position relative
	backdrop-filter blur(4px)
	z-index 1000
	align-items center
	font-family 'SF Pro Display', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif
	letter-spacing 0.4px
	
	&::before
		content ''
		position absolute
		inset -2px
		border-radius 16px
		padding 2px
		background linear-gradient(135deg, rgba(255, 100, 255, 0.15), rgba(100, 150, 255, 0.15))
		-webkit-mask linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)
		-webkit-mask-composite xor
		mask-composite exclude
		pointer-events none

	.buttons
		display flex
		gap 16px
		width 100%

	.select-gender
		color rgba(255, 255, 255, 0.7)
		font-size 16px
		font-weight 500
		text-transform uppercase
		letter-spacing 1.2px
		margin-bottom 4px
		
	button
		appearance none
		margin 0
		padding 16px 32px
		border-radius 16px
		background linear-gradient(135deg, rgba(255, 255, 0, 0.08), rgba(0, 255, 255, 0.04))
		color rgba(255, 255, 255, 0.85)
		cursor pointer
		transition all 0.3s cubic-bezier(0.4, 0, 0.2, 1)
		font-size 18px
		font-weight 600
		letter-spacing 0.5px
		text-transform capitalize
		flex 1
		position relative
		overflow hidden
		border 1px solid rgba(255, 255, 255, 0.1)
		backdrop-filter blur(10px)
				
		&:hover
			background linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.06))
			box-shadow 0 8px 24px rgba(0, 0, 0, 0.2)
			
		&:active
			transform translateY(0)
			transition-duration 0.1s
		
		&.man.active
			background linear-gradient(135deg, rgba(255, 50, 50, 0.9) 0%, rgba(255, 200, 50, 0.9) 100%)
			color rgba(10, 10, 30, 1)
			font-weight 700
			box-shadow 0 12px 32px rgba(255, 100, 50, 0.3), inset 0 0 20px rgba(255, 255, 100, 0.2)
			
		&.woman.active
			background linear-gradient(135deg, rgba(255, 150, 200, 0.9) 0%, rgba(255, 255, 255, 0.95) 100%)
			color rgba(10, 10, 30, 1)
			font-weight 700
			box-shadow 0 12px 32px rgba(255, 150, 200, 0.3), inset 0 0 20px rgba(255, 255, 255, 0.3)

@media (max-width: 480px)
	.morph-ui
		bottom 30px
		max-width 90%
		padding 20px 24px
		gap 16px
		
		.select-gender
			font-size 14px
			
		button
			padding 14px 24px
			font-size 16px
</style>


