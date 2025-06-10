import GUI from 'lil-gui'
const gui = new GUI()

// Helper to prevent object to be dragged when clicking on the GUI
// use : `if( isEventInsideGUI( e ) )return`
export const isEventInsideGUI = ( e ) => gui ? gui.domElement.contains( e.target ) : false

export { gui }
export default gui
