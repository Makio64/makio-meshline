<template>
	<div class="morph-ui">
		<div class="select-gender">Select your gender</div>
		<div class="buttons">
			<button :class="{ active: selectedGender === 'man', man: true }" title="Man" @click="onMan">
				<span>Man</span>
				<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
					<path d="M15.05 8.537L18.585 5H14V3h8v8h-2V6.414l-3.537 3.537a7.5 7.5 0 1 1-1.414-1.414zM10.5 20a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z" />
				</svg>
			</button>
			<button :class="{ active: selectedGender === 'woman', woman: true }" title="Woman" @click="onWoman">
				<span>Woman</span>
				<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
					<path d="M11 15.934V19H9v2h2v2h2v-2h2v-2h-2v-3.066A7.5 7.5 0 1 0 11 15.934zM12 14a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
				</svg>
			</button>
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
	bottom 10px
	left auto 
	right auto
	display flex
	flex-direction column
	max-width 200px
	margin auto
	gap 20px
	padding 20px
	border-radius 20px
	background rgba(15, 15, 20, 0.4)
	border 1px solid rgba(255, 255, 255, 0.1)
	backdrop-filter blur(12px)
	-webkit-backdrop-filter blur(12px)
	z-index 1000
	align-items center
	font-family 'SF Pro Display', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif
	letter-spacing 0.4px
	box-shadow 0 0px 32px rgba(0, 0, 0, 0.8)

	.buttons
		display flex
		gap 16px
		width 100%
		display flex
		align-items center
		justify-content center

	.select-gender
		color rgba(255, 255, 255, 0.7)
		font-size 12px
		font-weight 500
		text-transform uppercase
		letter-spacing 1.1px
		
	button
		appearance none
		margin 0
		padding 10px 20px
		border-radius 14px
		background linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)
		color rgba(255, 255, 255, 0.9)
		cursor pointer
		transition background 0.8s cubic-bezier(0.4, 0, 0.2, 1)
		position relative
		overflow hidden
		border none
		box-shadow 0 4px 12px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 -1px 0 rgba(0, 0, 0, 0.2)
		display flex
		align-items center
		justify-content center
		// min-width 80px
		border-radius 50px
		font-size 14px
		
		svg
			width 28px
			height 28px
				
		&:hover
			box-shadow 0 6px 16px rgba(0, 0, 0, 0.2), 0 3px 6px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15), inset 0 -1px 0 rgba(0, 0, 0, 0.2)
			
		&:active
			box-shadow 0 2px 8px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 -1px 0 rgba(0, 0, 0, 0.25)
			transition-duration 0.05s
		&.man.active, &.woman.active
			background linear-gradient(135deg, #f093fb 0%, #f5576c 100%)
			color rgba(255, 255, 255, 1)
			font-weight 600
			box-shadow 0 4px 12px rgba(240, 147, 251, 0.15), 0 2px 4px rgba(240, 147, 251, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 -2px 4px rgba(215, 67, 87, 0.3)
			text-shadow 0 1px 2px rgba(0, 0, 0, 0.15)
			
			&:hover
				box-shadow 0 6px 16px rgba(240, 147, 251, 0.2), 0 3px 6px rgba(240, 147, 251, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.35), inset 0 -2px 4px rgba(215, 67, 87, 0.3)
			
			&:active
				box-shadow 0 2px 8px rgba(240, 147, 251, 0.15), 0 1px 3px rgba(240, 147, 251, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -2px 4px rgba(215, 67, 87, 0.4)
</style>


