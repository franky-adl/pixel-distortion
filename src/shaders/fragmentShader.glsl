uniform sampler2D uTexture;
uniform sampler2D uDataTexture;
uniform vec4 resolution;
uniform vec2 uv_factor;
varying vec2 vUv;
float PI = 3.141592653589793238;

void main()	{
	vec2 newUV = vUv * uv_factor + (vec2(1.) - uv_factor) * vec2(0.5);
	vec4 color = texture2D(uTexture, newUV);
	vec4 offset = texture2D(uDataTexture, vUv);
	// when mouse goes up, offset.g will be positive here,
	// so offsetted V becomes smaller => a lower texture point is shown on the spot
	// when mouse goes left, offset.r will be negative
	// so offsetted U becomes larger => a righter texture point is shown on the spot
	gl_FragColor = texture2D(uTexture, newUV - 0.02*offset.rg);
}