# audio

use case:
```
import stage from 'mnf/core/stage'
import audio from 'mnf-audio/audio'
import AudioAnalyser from 'mnf-audio/AudioAnalyser'
import AudioDebuger from 'mnf-audio/AudioDebuger'

//...
audio.start({
	live : false,
	playlist : ["audio/galvanize.mp3"],
	mute : false,
	onLoad : ()=>{
		//optionnal stuffs
		audio.analyser = new AudioAnalyser(audio)
		audio.analyser.debuger = new AudioDebuger(audio.analyser)
		audio.onBeat.add(()=>{console.log('beat')})
		stage.onUpdate.add(this.update)
	}
})

```
