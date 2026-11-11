import stage3d from '@/makio/three/stage3d'
import {
	AUTOSAVE_ID,
	createRoadSaveStore,
	createShareUrl,
	formatRoadFilename,
	parseRoad,
	readRoadFromLocation,
	serializeRoad,
	stripRoadFromHref,
} from '@/utils/roadSave'
import { MIN_LOOP } from '@/utils/surfaceRoadRoute'

/** Autosave, named slots, JSON files and share links for the road on screen. */
export class RoadSaves {
	saveStore = createRoadSaveStore()
	fileInput = document.createElement( 'input' )
	autosaveTimer = 0
	autosavePending = false
	suspendAutosave = false

	constructor( demo ) {
		this.demo = demo
		this.ui = demo.ui
		this.fileInput.type = 'file'
		this.fileInput.accept = 'application/json,.json'
		stage3d.listen( this.fileInput, 'change', this.onRoadFileChosen )
	}

	captureRoad( { id, name = this.ui.saveName } = {} ) {
		return serializeRoad( { name, roadWidth: this.demo.roadWidth, controls: this.demo.controls, closed: true, id } )
	}

	applyRoadRecord( record ) {
		const parsed = parseRoad( record )
		if ( parsed.controls.length < MIN_LOOP ) throw new RangeError( 'A track needs at least three points.' )
		this.demo.roadWidth = parsed.roadWidth
		if ( parsed.id !== AUTOSAVE_ID && parsed.name ) this.ui.saveName = parsed.name
		this.ui.activeSaveId = parsed.id ?? ''
		this.suspendAutosave = true
		try {
			this.demo.setControls( parsed.controls )
		} finally {
			this.suspendAutosave = false
		}
	}

	/** Bring back the road of a share link or the last session, if there is one. */
	restoreSavedRoad() {
		this.refreshSaveUi()
		const fromUrl = readRoadFromLocation( window.location.href )
		const record = fromUrl ?? this.saveStore.get( AUTOSAVE_ID )
		if ( !record ) return false
		try {
			this.applyRoadRecord( record )
			this.ui.saveMessage = fromUrl ? 'Loaded shared road' : 'Restored last road'
			return true
		} catch {
			this.ui.saveMessage = 'Saved road could not be restored'
			return false
		} finally {
			this.refreshSaveUi()
		}
	}

	scheduleAutosave() {
		if ( this.suspendAutosave ) return
		if ( this.demo.editor.isDragging ) {
			this.autosavePending = true
			return
		}
		clearTimeout( this.autosaveTimer )
		this.autosaveTimer = setTimeout( () => this.persistAutosave(), 200 )
	}

	/** A drag held the autosave back until it ended. */
	flushAutosave() {
		if ( !this.autosavePending ) return
		this.autosavePending = false
		this.persistAutosave()
	}

	cancelAutosave() {
		clearTimeout( this.autosaveTimer )
		this.autosavePending = false
	}

	persistAutosave() {
		let saved = null
		try {
			saved = this.saveStore.autosave( this.captureRoad( { id: AUTOSAVE_ID } ) )
		} catch {
			return
		}
		if ( !saved ) return
		this.stripSharedRoadFromUrl()
		this.refreshSaveUi()
	}

	stripSharedRoadFromUrl() {
		const next = stripRoadFromHref( window.location.href )
		if ( next !== window.location.href ) window.history.replaceState( null, '', next )
	}

	refreshSaveUi() {
		this.ui.storageAvailable = this.saveStore.available
		this.ui.saves = this.saveStore.list().map( slot => ( {
			id: slot.id,
			name: slot.name,
			points: slot.controls.length,
			savedAt: slot.savedAt,
			autosave: slot.id === AUTOSAVE_ID,
		} ) )
	}

	/** The HUD is live before the first road exists. */
	isRoadReady() {
		const ready = this.demo.controls.length >= MIN_LOOP
		if ( !ready ) this.ui.saveMessage = 'Road is not ready'
		return ready
	}

	saveNamedRoad( name ) {
		if ( !this.isRoadReady() ) return
		let saved = null
		try {
			saved = this.saveStore.saveNamed( this.captureRoad( { name } ) )
		} catch {
			// Reported below, like a store that refused the write.
		}
		if ( saved ) {
			this.ui.saveName = saved.name
			this.ui.activeSaveId = saved.id
			this.ui.saveMessage = `Saved ${saved.name}`
		} else {
			this.ui.saveMessage = this.saveStore.available ? 'Could not save' : 'Storage is blocked'
		}
		this.refreshSaveUi()
	}

	loadSavedRoad( id ) {
		const record = this.saveStore.get( id )
		if ( !record ) {
			this.ui.saveMessage = 'That save is gone'
			this.refreshSaveUi()
			return
		}
		try {
			this.applyRoadRecord( record )
		} catch {
			this.ui.saveMessage = 'Could not load that save'
			return
		}
		this.persistAutosave()
		this.ui.saveMessage = `Loaded ${record.name}`
		this.refreshSaveUi()
	}

	deleteSavedRoad( id ) {
		const removed = this.saveStore.remove( id )
		if ( this.ui.activeSaveId === id ) this.ui.activeSaveId = AUTOSAVE_ID
		this.ui.saveMessage = removed ? 'Save deleted' : 'That save is gone'
		this.refreshSaveUi()
	}

	exportRoadFile() {
		if ( !this.isRoadReady() ) return
		try {
			const record = this.captureRoad()
			const blob = new Blob( [`${JSON.stringify( record, null, '\t' )}\n`], { type: 'application/json' } )
			const url = URL.createObjectURL( blob )
			const link = document.createElement( 'a' )
			link.href = url
			link.download = formatRoadFilename( record )
			link.click()
			URL.revokeObjectURL( url )
			this.ui.saveMessage = 'Exported JSON'
		} catch {
			this.ui.saveMessage = 'Could not export'
		}
	}

	importRoadFile() {
		this.fileInput.value = ''
		this.fileInput.click()
	}

	onRoadFileChosen = async () => {
		const file = this.fileInput.files[0]
		if ( !file ) return
		try {
			const text = await file.text()
			if ( this.demo.disposed ) return
			const record = parseRoad( text )
			this.applyRoadRecord( record )
			this.persistAutosave()
			this.ui.saveMessage = `Imported ${record.controls.length} points`
		} catch {
			this.ui.saveMessage = 'Could not read that road file'
		}
		this.refreshSaveUi()
	}

	async copyShareLink() {
		if ( !this.isRoadReady() ) return
		let url
		try {
			url = createShareUrl( window.location.href, this.captureRoad() )
		} catch {
			this.ui.saveMessage = 'Could not copy link'
			return
		}
		try {
			await navigator.clipboard.writeText( url )
			this.ui.saveMessage = 'Link copied'
		} catch {
			this.ui.saveMessage = url
		}
	}
}
