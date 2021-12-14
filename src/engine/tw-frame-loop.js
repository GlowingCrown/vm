// Due to the existence of features such as interpolation and "0 FPS" being treated as "screen refresh rate",
// The VM loop logic has become much more complex

// Use setTimeout to polyfill requestAnimationFrame in Node.js environments
const _requestAnimationFrame = typeof requestAnimationFrame === 'function' ?
    requestAnimationFrame :
    (f => setTimeout(f, 1000 / 60));
const _cancelAnimationFrame = typeof requestAnimationFrame === 'function' ?
    cancelAnimationFrame :
    clearTimeout;

const animationFrameWrapper = callback => {
    let id;
    const handle = () => {
        id = _requestAnimationFrame(handle);
        callback();
    };
    const cancel = () => _cancelAnimationFrame(id);
    id = _requestAnimationFrame(handle);
    return {
        cancel
    };
};

class FrameLoop {
    constructor (runtime) {
        this.runtime = runtime;
        this.running = false;
        this.setFramerate(60);
        this.setInterpolation(false);

        this.stepCallback = runtime._step.bind(runtime);
        this.interpolationCallback = runtime._renderInterpolatedPositions.bind(runtime);

        this._stepInterval = null;
        this._interpolationAnimation = null;
        this._stepAnimation = null;
    }

    setFramerate (fps) {
        this.framerate = fps;
        if (fps === 0) {
            this.runtime.currentStepTime = 1000 / 60;
        } else {
            this.runtime.currentStepTime = 1000 / this.framerate;
        }
        this._restart();
    }

    setInterpolation (interpolation) {
        this.interpolation = interpolation;
        this._restart();
    }

    _restart () {
        if (this.running) {
            this.stop();
            this.start();
        }
    }

    start () {
        this.running = true;
        if (this.framerate === 0) {
            this._stepAnimation = animationFrameWrapper(this.stepCallback);
        } else {
            // Interpolation should never be enabled when framerate === 0 as that's just redundant
            if (this.interpolation) {
                this._interpolationAnimation = animationFrameWrapper(this.interpolationCallback);
            }
            this._stepInterval = setInterval(this.stepCallback, 1000 / this.framerate);
        }
    }

    stop () {
        this.running = false;
        clearInterval(this._stepInterval);
        if (this._interpolationAnimation) {
            this._interpolationAnimation.cancel();
        }
        if (this._stepAnimation) {
            this._stepAnimation.cancel();
        }
        this._interpolationAnimation = null;
        this._stepAnimation = null;
    }
}

module.exports = FrameLoop;
