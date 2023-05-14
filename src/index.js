// ThreeJS and Third-party deps
import * as THREE from "three"
import * as dat from 'dat.gui'
import Stats from "three/examples/jsm/libs/stats.module"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"

// Core boilerplate code deps
import { createRenderer, runApp, getDefaultUniforms } from "./core-utils"
import { clamp } from "./common-utils"

// Other deps
import vertex from "./shaders/vertexShader.glsl"
import fragment from "./shaders/fragmentShader.glsl"

global.THREE = THREE
// previously this feature is .legacyMode = false, see https://www.donmccurdy.com/2020/06/17/color-management-in-threejs/
// turning this on has the benefit of doing certain automatic conversions (for hexadecimal and CSS colors from sRGB to linear-sRGB)
THREE.ColorManagement.enabled = true

/**************************************************
 * 0. Tweakable parameters for the scene
 *************************************************/
const params = {
  // general scene params
  grid: 15,
  aoe: 0.13,
  strength: 0.15,
  relaxation: 0.9,
}
const uniforms = {
  ...getDefaultUniforms(),
  uv_factor: {
    value: new THREE.Vector2(0, 0)
  }
}


/**************************************************
 * 1. Initialize core threejs components
 *************************************************/
// Create the scene
let scene = new THREE.Scene()

// Create the renderer via 'createRenderer',
// 1st param receives additional WebGLRenderer properties
// 2nd param receives a custom callback to further configure the renderer
let renderer = createRenderer({ antialias: true }, (_renderer) => {
  // best practice: ensure output colorspace is in sRGB, see Color Management documentation:
  // https://threejs.org/docs/#manual/en/introduction/Color-management
  _renderer.outputEncoding = THREE.sRGBEncoding
})

// Create the camera
var frustumSize = 1;
let camera = new THREE.OrthographicCamera(frustumSize / -2, frustumSize / 2, frustumSize / 2, frustumSize / -2, -1000, 1000);
camera.position.set(0, 0, 2);

/**************************************************
 * 2. Build your scene in this threejs app
 * This app object needs to consist of at least the async initScene() function (it is async so the animate function can wait for initScene() to finish before being called)
 * initScene() is called after a basic threejs environment has been set up, you can add objects/lighting to you scene in initScene()
 * if your app needs to animate things(i.e. not static), include a updateScene(interval, elapsed) function in the app as well
 *************************************************/
let app = {
  // This is called by the mousemove event registered in core-utils
  mouseMoveEvent(e) {
    this.mouse.x = e.clientX / window.innerWidth
    this.mouse.y = e.clientY / window.innerHeight

    // going left: vX negative
    this.mouse.vX = this.mouse.x - this.mouse.prevX
    // going up: vY negative
    this.mouse.vY = this.mouse.y - this.mouse.prevY

    this.mouse.prevX = this.mouse.x
    this.mouse.prevY = this.mouse.y
  },
  // This updates the uv_factor such that the fragment shader can show the image
  // in a css “background-size: cover” fashion
  updateUVFactor() {
    let wFactor, hFactor
    if (window.innerHeight / window.innerWidth > this.imgAspect) {
      // fit image until its height matches with window
      // first calculate the heightRatio needed for the image height to fit with the window height
      let heightRatio = window.innerHeight / this.img.height
      // then calculate how much the actual width of UV need to shrink in order to preserve image aspect
      wFactor = window.innerWidth / (this.img.width * heightRatio)
      hFactor = 1
    } else {
      // fit image until its width matches with window
      let widthRatio = window.innerWidth / this.img.width
      wFactor = 1
      hFactor = window.innerHeight / (this.img.height * widthRatio)
    }
    uniforms.uv_factor.value.x = wFactor
    uniforms.uv_factor.value.y = hFactor
  },
  // This is to randomize the grid offsets, both for the beginning and resize
  regenerateGrid() {
    this.size = params.grid;

    const width = this.size;
    const height = this.size;

    const size = width * height;
    const data = new Float32Array(4 * size);
    const color = new THREE.Color(0xffffff);

    const r = Math.floor(color.r * 255);
    const g = Math.floor(color.g * 255);
    const b = Math.floor(color.b * 255);

    for (let i = 0; i < size; i++) {
      let r = Math.random() * 255 - 125;
      let r1 = Math.random() * 255 - 125;

      const stride = i * 4;

      data[stride] = r;
      data[stride + 1] = r1;
      data[stride + 2] = r;
      data[stride + 3] = r;

    }

    // used the buffer to create a DataTexture
    this.dataTexture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);

    this.dataTexture.magFilter = this.dataTexture.minFilter = THREE.NearestFilter;

    if (this.material) {
      this.material.uniforms.uDataTexture.value = this.dataTexture;
      this.material.uniforms.uDataTexture.value.needsUpdate = true;
    }
  },
  // This is where the distortion is calculated and saved to the dataTexture
  updateDataTexture() {
    let data = this.dataTexture.image.data
    for (let i = 0; i < data.length; i += 4) {
      data[i] *= params.relaxation
      data[i + 1] *= params.relaxation
    }

    // this.mouse.x/y is 0..1, 
    // so gridMouseX/Y is the mouse coordinates in terms of the grid
    let gridMouseX = this.size * this.mouse.x
    let gridMouseY = this.size * (1 - this.mouse.y)
    // params.aoe affect the area of effect
    let maxDist = this.size * params.aoe
    let maxDistSq = maxDist ** 2
    let aspect = window.innerHeight / window.innerWidth

    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        // distance from pointer to mouse
        let distance = ((gridMouseX - i) ** 2) / aspect + (gridMouseY - j) ** 2
        if (distance < maxDistSq) {
          // get array index of the current pointer in data array
          let index = 4 * (i + this.size * j)

          // the closer to the mouse, the more powerful the distortion
          let power = maxDist / Math.sqrt(distance)
          power = clamp(power, 0, 10)

          // going left => offset.r decreases
          data[index] += params.strength * 100 * this.mouse.vX * power
          // going up => offset.g increases
          data[index + 1] -= params.strength * 100 * this.mouse.vY * power

        }
      }
    }

    this.mouse.vX *= 0.9
    this.mouse.vY *= 0.9
    this.dataTexture.needsUpdate = true
  },
  async initScene() {
    // OrbitControls
    this.controls = new OrbitControls(camera, renderer.domElement)
    this.controls.enableDamping = true

    this.mouse = {
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      vX: 0,
      vY: 0
    }

    // initialize the data texture ready
    this.regenerateGrid()

    this.img = document.getElementById("image")
    this.imgAspect = this.img.height / this.img.width
    let texture = new THREE.Texture(this.img)
    // without this line it seems the texture wouldn't load properly
    // maybe because the image data has loaded on the html yet?
    texture.needsUpdate = true

    this.updateUVFactor()

    this.material = new THREE.ShaderMaterial({
      extensions: {
        derivatives: "#extension GL_OES_standard_derivatives : enable"
      },
      side: THREE.DoubleSide,
      uniforms: {
        ...uniforms,
        uTexture: {
          value: texture
        },
        uDataTexture: {
          value: this.dataTexture
        },
      },
      vertexShader: vertex,
      fragmentShader: fragment
    });

    this.geometry = new THREE.PlaneGeometry(1, 1, 1, 1);

    this.plane = new THREE.Mesh(this.geometry, this.material);
    scene.add(this.plane)

    // GUI controls
    const gui = new dat.GUI()
    gui.add(params, "grid", 1, 500, 1).onChange(val => {
      this.regenerateGrid()
    })
    gui.add(params, "aoe", 0, 2, 0.02)
    gui.add(params, "strength", 0, 2, 0.02)
    gui.add(params, "relaxation", 0, 1, 0.01)

    // Stats - show fps
    this.stats1 = new Stats()
    this.stats1.showPanel(0) // Panel 0 = fps
    this.stats1.domElement.style.cssText = "position:absolute;top:0px;left:0px;"
    // this.container is the parent DOM element of the threejs canvas element
    this.container.appendChild(this.stats1.domElement)
  },
  // @param {number} interval - time elapsed between 2 frames
  // @param {number} elapsed - total time elapsed since app start
  updateScene(interval, elapsed) {
    this.controls.update()
    this.stats1.update()
    this.updateDataTexture()
  }
}

/**************************************************
 * 3. Run the app
 * 'runApp' will do most of the boilerplate setup code for you:
 * e.g. HTML container, window resize listener, mouse move/touch listener for shader uniforms, THREE.Clock() for animation
 * Executing this line puts everything together and runs the app
 * ps. if you don't use custom shaders, pass undefined to the 'uniforms'(2nd-last) param
 * ps. if you don't use post-processing, pass undefined to the 'composer'(last) param
 *************************************************/
runApp(app, scene, renderer, camera, true, uniforms, undefined)
