<!-- Add a "Press" FX, usefull to add a button effect on any element, just embed it inside an ButtonFX by @makio64 -->
<template>
	<div class="ButtonFX" @click="onClick" @pointerdown="onDown" @pointerup="onUp" @pointerout="onUp">
		<div class="buttonAnim" :class="{ isDown: isDown, strong: power == 'strong', strongInverted: power == 'strongInverted' }">
			<slot />
		</div>
	</div>
</template>

<script>
export default {
	name: 'ButtonFX',
	data() {
		return {
			isDown: false,
		}
	},
	props: {
		anim: {
			type: String,
			default: '',
		},
		power: {
			type: String,
			default: 'normal',
		},
		enabled: {
			type: Boolean,
			default: true,
		},
	},
	mounted() {},
	methods: {
		onUp() {
			this.isDown = false
			if ( !this.clicked && this.time < 2 ) {
				this.$el.click()
			}
		},
		onClick() {
			this.clicked = true
		},
		onDown() {
			this.time = Date.now()
			if ( this.enabled ) {
				this.isDown = true
			}
		},
	},
}
</script>

<style lang="stylus" scoped>
.ButtonFX
	text-align: center
	cursor pointer
	.buttonAnim
		transition transform 0.2s
	.isDown
		transform scale(.96)
		transform-origin center center
		&.strong
			transform scale(.85)
		&.strongInverted
			transform scale(1.2)
</style>
