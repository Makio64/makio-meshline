import App from '@/App.vue'
import TranslatePlugin from './plugins/TranslatePlugin'
import { TinyRouterInstall } from 'vue-tiny-router'

async function init() {
	const app = createApp( App )

	app.use( TranslatePlugin )
	app.use( TinyRouterInstall )
	app.mount( '#app' )
}
init()
