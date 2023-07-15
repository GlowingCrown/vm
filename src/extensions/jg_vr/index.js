const BlockType = require('../../extension-support/block-type');
const ArgumentType = require('../../extension-support/argument-type');
const Cast = require('../../util/cast');

const SESSION_TYPE = "immersive-vr";

// WebXR unfortunately does not give us Euler angles easily
// so lets do it ourselves
// thanks to twoerner94 for quaternion-to-euler on npm
function quaternionToEuler(quat) {
    const q0 = quat[0];
    const q1 = quat[1];
    const q2 = quat[2];
    const q3 = quat[3];

    const Rx = Math.atan2(2 * (q0 * q1 + q2 * q3), 1 - (2 * (q1 * q1 + q2 * q2)));
    const Ry = Math.asin(2 * (q0 * q2 - q3 * q1));
    const Rz = Math.atan2(2 * (q0 * q3 + q1 * q2), 1 - (2 * (q2 * q2 + q3 * q3)));

    const euler = [Rx, Ry, Rz];

    return euler;
};

function toRad(deg) {
    return deg * (Math.PI / 180);
}
function toDeg(rad) {
    return rad * (180 / Math.PI);
}

/**
 * Class of 2025
 * @constructor
 */
class jgVr {
    constructor(runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {runtime}
         */
        this.runtime = runtime;
        this.open = false;
        this.session = null;

        /**
         * User's device containing info about the controllers and headset.
         */
        this.device = null;
    }

    /**
     * @returns {object} metadata for this extension and its blocks.
     */
    getInfo() {
        return {
            id: 'jgVr',
            name: 'Virtual Reality',
            color1: '#3888cf',
            color2: '#2f72ad',
            blocks: [
                // CORE
                {
                    opcode: 'isSupported',
                    text: 'is vr supported?',
                    blockType: BlockType.BOOLEAN,
                    disableMonitor: true
                },
                {
                    opcode: 'createSession',
                    text: 'create vr session',
                    blockType: BlockType.COMMAND
                },
                {
                    opcode: 'closeSession',
                    text: 'close vr session',
                    blockType: BlockType.COMMAND
                },
                {
                    opcode: 'isOpened',
                    text: 'is vr open?',
                    blockType: BlockType.BOOLEAN,
                    disableMonitor: true
                },
                '---', // HEADSET POSITION
                {
                    opcode: 'headsetPosition',
                    text: 'headset position [VECTOR3]',
                    blockType: BlockType.REPORTER,
                    disableMonitor: true,
                    arguments: {
                        VECTOR3: {
                            type: ArgumentType.STRING,
                            menu: 'vector3'
                        }
                    }
                },
                {
                    opcode: 'headsetRotation',
                    text: 'headset rotation [VECTOR3]',
                    blockType: BlockType.REPORTER,
                    disableMonitor: true,
                    arguments: {
                        VECTOR3: {
                            type: ArgumentType.STRING,
                            menu: 'vector3'
                        }
                    }
                },
                '---', // CONTROLLER INPUT
                {
                    opcode: 'controllerPosition',
                    text: 'controller #[COUNT] position [VECTOR3]',
                    blockType: BlockType.REPORTER,
                    disableMonitor: true,
                    arguments: {
                        COUNT: {
                            type: ArgumentType.NUMBER,
                            menu: 'count'
                        },
                        VECTOR3: {
                            type: ArgumentType.STRING,
                            menu: 'vector3'
                        }
                    }
                },
                {
                    opcode: 'controllerRotation',
                    text: 'controller #[COUNT] rotation [VECTOR3]',
                    blockType: BlockType.REPORTER,
                    disableMonitor: true,
                    arguments: {
                        COUNT: {
                            type: ArgumentType.NUMBER,
                            menu: 'count'
                        },
                        VECTOR3: {
                            type: ArgumentType.STRING,
                            menu: 'vector3'
                        }
                    }
                },
                '---', // HELPER BLOCKS
                {
                    opcode: 'placement169',
                    text: '[SIDE] x placement',
                    blockType: BlockType.REPORTER,
                    disableMonitor: true,
                    arguments: {
                        SIDE: {
                            type: ArgumentType.STRING,
                            menu: 'side'
                        }
                    }
                },
            ],
            menus: {
                vector3: {
                    acceptReporters: true,
                    items: [
                        "x",
                        "y",
                        "z",
                    ].map(item => ({ text: item, value: item }))
                },
                count: {
                    acceptReporters: true,
                    items: [
                        "1",
                        "2",
                    ].map(item => ({ text: item, value: item }))
                },
                side: {
                    acceptReporters: false,
                    items: [
                        "left",
                        "right",
                    ].map(item => ({ text: item, value: item }))
                },
            }
        };
    }

    // menus
    _isVector3Menu(option) {
        const normalized = Cast.toString(option).toLowerCase().trim();
        return ['x', 'y', 'z'].includes(normalized);
    }

    // util
    _getCanvas() {
        if (!this.runtime) return;
        if (!this.runtime.renderer) return;
        return this.runtime.renderer.canvas;
    }
    _getContext() {
        if (!this.runtime) return;
        if (!this.runtime.renderer) return;
        return this.runtime.renderer.gl;
    }
    _getRenderer() {
        if (!this.runtime) return;
        return this.runtime.renderer;
    }

    _disposeImmersive() {
        this.session = null;
        const gl = this._getContext();
        if (!gl) return;
        // bind frame buffer to canvas
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // reset renderer info
        const renderer = this._getRenderer();
        if (!renderer) return;
        renderer.xrEnabled = false;
        renderer.xrLayer = null;
    }
    async _createImmersive() {
        if (!('xr' in navigator)) return false;
        const gl = this._getContext();
        if (!gl) return;
        const renderer = this._getRenderer();
        if (!renderer) return;

        await gl.makeXRCompatible();
        const session = await navigator.xr.requestSession(SESSION_TYPE);
        this.session = session;
        this.open = true;

        renderer.xrEnabled = true;

        // we need to make sure stuff is back to normal once the vr session is done
        // but this isnt always triggered by the close session block
        // the user can also close it themselves, so we need to handle that
        // this is also triggered by the close session block btw so we dont need
        // to repeat
        session.addEventListener("end", () => {
            this.open = false;
            this._disposeImmersive();
        });

        // set render state to use a new layer for the vr session
        // renderer will handle this
        const layer = new XRWebGLLayer(session, gl, {
            alpha: true,
            stencil: true,
            antialias: false,
        });
        session.updateRenderState({
            baseLayer: layer
        });
        renderer.xrLayer = layer;
        // for debugging & other extensions, never used by the renderer
        renderer._xrSession = session;

        // setup render loop
        const drawFrame = (_, frame) => {
            // breaks the loop once the session has ended
            if (!this.open) return;
            this.device = frame.device;
            // force renderer to draw a new frame
            // otherwise we would only actually draw outside of this loop
            // which just ends up showing nothing
            // since rendering only happens in session.requestAnimationFrame
            renderer.dirty = true;
            renderer.draw();
            // loop again
            session.requestAnimationFrame(drawFrame);
        }
        session.requestAnimationFrame(drawFrame);

        return session;
    }

    // blocks
    isSupported() {
        if (!('xr' in navigator)) return false;
        return navigator.xr.isSessionSupported(SESSION_TYPE);
    }
    isOpened() {
        return this.open;
    }

    createSession() {
        if (this.open) return;
        if (this.session) return;
        return this._createImmersive();
    }
    closeSession() {
        this.open = false;
        if (!this.session) return;
        return this.session.end();
    }

    // inputs
    headsetPosition(args) {
        if (!this.open) return;
        if (!this.session) return;
        if (!this.device) return;
        const vector3 = Cast.toString(args.VECTOR3).toLowerCase().trim();
        if (!this._isVector3Menu(vector3)) return;
        const axisArray = ['x', 'y', 'z'];
        const idx = axisArray.indexOf(vector3);
        return this.device.position[idx];
    }
    headsetRotation(args) {
        if (!this.open) return 0;
        if (!this.session) return 0;
        if (!this.device) return 0;
        const vector3 = Cast.toString(args.VECTOR3).toLowerCase().trim();
        if (!this._isVector3Menu(vector3)) return 0;
        const axisArray = ['x', 'y', 'z'];
        const idx = axisArray.indexOf(vector3);
        const quaternion = this.device.quaternion;
        const euler = quaternionToEuler(quaternion);
        return toDeg(euler[idx]);
    }

    // helper
    placement169(args) {
        const side = Cast.toString(args.SIDE).toLowerCase().trim();

        const width = this.runtime.stageWidth;
        const multX = width / 640;

        // this was found with experimentation
        // please tell me if stuff needs to be added for certain cases
        const valueR = ((640 / 4) - 40) * multX;
        const valueL = 0 - valueR;

        if (side === 'right') {
            return valueR;
        }
        return valueL;
    }
}

module.exports = jgVr;
