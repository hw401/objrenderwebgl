// 2023/06/29

const KEY_LEFT = 37;
const KEY_RIGHT = 39;
const KEY_UP = 38;
const KEY_DOWN = 40;

var vshader = `
attribute vec4 a_position;
attribute vec4 a_color;
attribute vec4 a_normal;
attribute vec2 a_texCoord;
uniform mat4 u_modelMat;
uniform mat4 u_viewMat;
uniform mat4 u_projMat;
uniform mat4 u_normalMat;
varying vec2 v_texCoord;
varying vec4 v_position;
varying vec3 v_normal;
varying vec4 v_color;
void main()
{
    gl_Position = u_projMat * u_viewMat * u_modelMat * a_position;
    v_normal = vec3(u_normalMat * a_normal);
    v_position = a_position;
    v_color = a_color;
    v_texCoord = a_texCoord;
}
`;

var fshader = `
precision mediump float;
uniform vec3 u_lightPosition;
uniform vec3 u_lightColor;
uniform vec3 u_ambient;
uniform sampler2D u_sampler;
uniform vec3 u_cameraPosition;
varying vec2 v_texCoord;
varying vec4 v_position;
varying vec3 v_normal;
varying vec4 v_color;
void main()
{
    //漫反射
    float k_diffuse = 0.5;
    vec3 normal = normalize(v_normal);
    vec3 lightDirection = normalize( u_lightPosition - vec3(v_position) );
    lightDirection = normalize(lightDirection);
    float cos = max(0.0, dot(normal,lightDirection) );
    // 注释中的代码使用mtl文件读取的颜色
    // vec3 diffuse = v_color.xyz * u_lightColor * cos;
    // vec3 ambient = v_color.xyz * u_ambient;
    vec4 texColor = texture2D(u_sampler,v_texCoord);
    vec3 diffuse = texColor.xyz * u_lightColor * cos * k_diffuse;
    //高光
    float k_specular = 1.0;
    float n = 10.0;
    vec3 cameraDirection = normalize(u_cameraPosition - vec3(v_position) );
    vec3 reflection = reflect(-lightDirection, normal);
    vec3 specular = pow(max(0.0, dot(reflection, cameraDirection)), n) * u_lightColor * k_specular;
    //环境光
    vec3 ambient = texColor.xyz * u_ambient;
    gl_FragColor = vec4(diffuse + ambient + specular, v_color.a);
}
`;

class LineString {
    constructor(line) {
        this.line = line;
    }

    getCommand() {
        var words = this.line.split(' ');
        var command = words[0];
        return command;
    }
    getName() {
        var words = this.line.split(' ');
        var name = words[1];
        return name;
    }
    getVector3f() {
        var words = this.line.split(' ');
        var aVector = new vec3f(parseFloat(words[1]), parseFloat(words[2]), parseFloat(words[3]));
        return aVector;
    }
}

class Object3D {

    objFile;
    mtlFile;
    allBuffers;
    indexAmount;

    modelMat;
    normalMat;

    async create(gl) {
        this.allBuffers = initAllBuffers(gl);
        let theFileName = 'Equip_Pole_Zephyrus_Model.obj';
        let textureFileName = 'Equip_Pole_Zephyrus_02_Tex_Diffuse.png';
        this.objFile = await readOBJ(theFileName);
        this.mtlFile = await readMTL(this.objFile.MTLFilePath);
        await loadTexture(gl, textureFileName);
        this.modelMat = initModelMat(gl);
        this.normalMat = initNormalMat(gl);

        this.indexAmount = getIndexAmount(this.objFile);
        passDataIntoBuffers(this.objFile, this.mtlFile, gl, this.allBuffers, this.indexAmount);
    }

    draw(gl) {
        passMatrix(gl, this.modelMat, 'u_modelMat');
        passMatrix(gl, this.normalMat, 'u_normalMat');
        draw(gl, this.indexAmount);
    }
}

class OBJDocument {
    constructor(fileName) {
        this.fileName = fileName;
        this.objects = new Array(0);
        this.objectNumber = 0;
        this.MTLFilePath = new String();
    }

    addObject(theObject) {
        this.objects.push(theObject);
        this.objectNumber += 1;
    }
}

class AnObject {
    constructor() {
        this.name = null;
        this.vertices = new Array(0);
        this.normals = new Array(0);
        this.texCoords = new Array(0);
        this.facesByMaterial = new Array(0);
    }

    nameIt(name) {
        this.name = name;
    }
    addFaces(theFacesUnderAMaterial) {
        this.facesByMaterial.push(theFacesUnderAMaterial);
    }
    addVertex(aVertex) {
        this.vertices.push(aVertex);
    }
    addNormal(aNormal) {
        this.normals.push(aNormal);
    }
    addTexCoord(aTexCoord) {
        this.texCoords.push(aTexCoord);
    }
}

class FacesUnderAMaterial {
    constructor() {
        this.mtlName = null;
        this.faces = new Array(0);
    }

    nameIt(name) {
        this.mtlName = name;
    }

    addFace(theFace) {
        this.faces.push(theFace);
    }
}

class AFace {
    points;
    theNormal;
    constructor() {
        this.vertexIndex = new Array(0);
        this.normalIndex = new Array(0);
        this.texCoordIndex = new Array(0);
        this.dataNumber = 0;
    }
    generateFaceFromLine(theLine) {
        this.getAllIndex(theLine);
        this.dataNumber = this.getDataNumber(theLine);
    }
    getAllIndex(theLine) {
        let words = theLine.line.split(' ');
        for (let i = 1; i < words.length; ++i) {
            let seperatedNumbers = words[i].split('/');
            this.vertexIndex.push(seperatedNumbers[0]);
            this.texCoordIndex.push(seperatedNumbers[1]);
            this.normalIndex.push(seperatedNumbers[2]);
        }
    }
    getDataNumber(theLine) {
        var words = theLine.line.split(' ');
        return (words.length - 1);
    }

    //以下是凹多边形判断算法的相关方法
    isConvexPolygon(theObject) {
        let isAConvexPolygon = true;
        this.getPoints(theObject);      //获得本面的points属性
        this.getTheNormal(theObject);   //获得本面的theNormal属性
        //判断顶点是否为凹点：
        // - 从编号1的点开始遍历每个点（假设顶点编号为n），则叉积向量(n,n+1)×(n,n-1)，若结果与法向量同向，则为凸点，否则为凹点
        // - 如果没有凹点，则进入凸多边形的分割算法out
        for (let apexIndex = 0; apexIndex < this.points.length; ++apexIndex) {
            let endPointOneIndex;
            let endPointTwoIndex;
            if (apexIndex == 0) {
                endPointOneIndex = this.points.length - 1;
                endPointTwoIndex = apexIndex + 1;
            }
            else if (apexIndex == this.points.length - 1) {
                endPointOneIndex = apexIndex - 1;
                endPointTwoIndex = 0;
            }
            else {
                endPointOneIndex = apexIndex - 1;
                endPointTwoIndex = apexIndex + 1;
            }
            if (!this.isConvexPoint(apexIndex, endPointOneIndex, endPointTwoIndex)) {
                isAConvexPolygon = false;
            }
        }
        return isAConvexPolygon;
    }
    getPoints(theObject) {
        this.points = new Array(0);
        for (let index of this.vertexIndex) {
            index -= 1;
            let aPoint = new PolygonVec3f();
            aPoint.x = theObject.vertices[index].x;
            aPoint.y = theObject.vertices[index].y;
            aPoint.z = theObject.vertices[index].z;
            this.points.push(aPoint);
        }
    }
    getTheNormal(theObject) {
        this.theNormal = new vec3f();
        let theNormalIndex = this.normalIndex[0];
        this.theNormal = theObject.normals[theNormalIndex - 1];
    }
    isConvexPoint(apexIndex, endPointOneIndex, endPointTwoIndex) {
        let vectorOne = this.getVector(this.points[apexIndex], this.points[endPointOneIndex]);
        let vectorTwo = this.getVector(this.points[apexIndex], this.points[endPointTwoIndex]);
        let result = vectorTwo.cross(vectorOne);
        if (result.dot(this.theNormal) >= 0) {
            this.points[apexIndex].isConvex = true;
            return true;
        }
        else if (result.dot(this.theNormal) < 0) {
            this.points[apexIndex].isConvex = false;
            return false;
        }
    }
    getVector(apex, endPoint) {
        let vector = new PolygonVec3f(apex.x - endPoint.x, apex.y - endPoint.y, apex.z - endPoint.z);
        return vector;
    }
}

class MTLDocument {
    constructor() {
        this.fileName = new String();
        this.materials = new Array(0);
        this.materialNumber = 0;
    }

    nameIt(fileName) {
        this.fileName = fileName;
    }

    addMaterial(theMaterial) {
        this.materials.push(theMaterial);
        this.materialNumber += 1;
    }
}

class AMaterial {
    constructor() {
        this.name = null;
        this.Kd = new vec3f();
    }

    nameIt(name) {
        this.name = name;
    }
}

class vec3f {
    x
    y
    z
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
}

class PolygonVec3f extends vec3f {
    isConvex
    constructor(x, y, z) {
        super(x, y, z);
        this.isConvex = new Boolean(true);
    }

    normalize() {
        length = Math.sqrt(Math.pow(this.x, 2) + Math.pow(this.y, 2) + Math.pow(this.z, 2));
        this.x = this.x / length;
        this.y = this.y / length;
        this.z = this.z / length;
    }
    dot(avec) {
        let result = this.x * avec.x + this.y * avec.y + this.z * avec.z;
        return result;
    }
    cross(avec) {
        let result = new PolygonVec3f(0, 0, 0);
        result.x = this.y * avec.z - this.z * avec.y;
        result.y = this.z * avec.x - this.x * avec.z;
        result.z = this.x * avec.y - this.y * avec.x;
        return result;
    }
}

function initAllBuffers(gl) {
    var allBuffers = new Object();
    allBuffers.vertexBuffer = initEmptyArrayBuffer(gl, 'a_position', 3, gl.FLOAT);
    allBuffers.normalBuffer = initEmptyArrayBuffer(gl, 'a_normal', 3, gl.FLOAT);
    allBuffers.texCoordBuffer = initEmptyArrayBuffer(gl, 'a_texCoord', 2, gl.FLOAT);
    allBuffers.colorBuffer = initEmptyArrayBuffer(gl, 'a_color', 3, gl.FLOAT);
    allBuffers.indexBuffer = initEmptyElementArrayBuffer(gl);
    return allBuffers;
}

function initEmptyArrayBuffer(gl, attribName, dimension, type) {
    var location = gl.getAttribLocation(gl.program, attribName);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(location, dimension, type, false, 0, 0);
    gl.enableVertexAttribArray(location);
    return buffer;
}

function initEmptyElementArrayBuffer(gl) {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    return buffer;
}

async function readOBJ(fileName) {
    return new Promise((resolve) => {
        var objFile = new OBJDocument(fileName);
        var request = new XMLHttpRequest();
        request.onreadystatechange = function () {
            if (request.readyState == 4 && request.status != 404) {
                objFile = onReadOBJ(request.responseText, fileName);
                resolve(objFile);
            }
        }
        request.open('GET', fileName, true);
        request.send();
    })
}

function onReadOBJ(fileString, fileName) {
    var objFile = new OBJDocument(fileName);
    var lines = fileString.split('\n');
    lines.push(null);
    console.log(objFile)

    var line;
    var index = 0;
    while ((line = lines[index++]) != null) {
        var theLine = new LineString(line);
        var command = theLine.getCommand();
        switch (command) {
            case '#':
                continue;
            case 'mtllib':
                objFile.MTLFilePath = theLine.getName();
                continue;
            case 'o':
            case 'g':
                if (theObject) {
                    objFile.addObject(theObject);
                }
                var theObject = new AnObject();
                theObject.nameIt(theLine.getName());
                continue;
            case 'v':
                var aVertex = theLine.getVector3f();
                theObject.addVertex(aVertex);
                continue;
            case 'vn':
                var aNormal = theLine.getVector3f();
                theObject.addNormal(aNormal);
                continue;
            case 'vt':
                var aTexCoord = theLine.getVector3f();
                theObject.addTexCoord(aTexCoord);
                continue;
            case 'usemtl':
                if (theFacesUnderAMaterial) {
                    theObject.addFaces(theFacesUnderAMaterial);
                }
                var theFacesUnderAMaterial = new FacesUnderAMaterial();
                theFacesUnderAMaterial.nameIt(theLine.getName());
                continue;
            case 'f':
                var theFace = new AFace();
                theFace.generateFaceFromLine(theLine);
                theFacesUnderAMaterial.addFace(theFace);
                continue;
            default:
                continue;
        }
    }
    theObject.facesByMaterial.push(theFacesUnderAMaterial);
    objFile.addObject(theObject);
    return objFile;
}

async function readMTL(fileName) {
    return new Promise((resolve) => {
        var MTLFile = new MTLDocument();
        var request = new XMLHttpRequest();
        request.onreadystatechange = function () {
            if (request.readyState == 4 && request.status != 404) {
                MTLFile = onReadMTL(request.responseText, fileName);
                resolve(MTLFile);
            }
        }
        request.open('GET', fileName, true);
        request.send();
    })
}

function onReadMTL(fileString, fileName) {
    var MTLFile = new MTLDocument();
    MTLFile.nameIt(fileName);

    var lines = fileString.split('\n');
    lines.push(null);
    var line;
    var index = 0;
    while ((line = lines[index++]) != null) {
        var theLine = new LineString(line);
        var command = theLine.getCommand();
        switch (command) {
            case '#':
                continue;
            case 'newmtl':
                if (theMaterial) {
                    MTLFile.addMaterial(theMaterial);
                }
                var theMaterial = new AMaterial();
                theMaterial.nameIt(theLine.getName());
                continue;
            case 'Kd':
                theMaterial.Kd = theLine.getVector3f();
                continue;
            default:
                continue;
        }
    }
    MTLFile.addMaterial(theMaterial);
    return MTLFile;
}

async function loadTexture(gl, textureFileName) {

    let image = new Image();
    return new Promise((resolve) => {
        image.onload = function () {
            onLoadTexture(gl, image);
            resolve();
        }
        image.src = textureFileName;
    })
}

function onLoadTexture(gl, image) {
    let texture = gl.createTexture();
    let u_sampler = gl.getUniformLocation(gl.program, 'u_sampler');
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.uniform1i(u_sampler, 0);
}

function draw(gl, pointAmount) {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, pointAmount);
}

function passDataIntoBuffers(objFile, mtlFile, gl, allBuffers, indexAmount) {
    passColorIntoBuffer(objFile, mtlFile, gl, allBuffers, indexAmount);
    passVertexIntoBuffer(objFile, gl, allBuffers, indexAmount);
    passTexCoordsIntoBuffer(objFile, gl, allBuffers, indexAmount);
    passNormalIntoBuffer(objFile, gl, allBuffers, indexAmount);
}

function passColorIntoBuffer(objFile, mtlFile, gl, allBuffers, indexAmount) {
    var colors = new Float32Array(indexAmount * 3);
    var dataCount = 0;
    for (const theObject of objFile.objects) {
        for (const theFaces of theObject.facesByMaterial) {
            var materialName = theFaces.mtlName;
            var theRightMaterial = mtlFile.materials.find(theMaterial => {
                if (theMaterial.name == materialName)
                    return theMaterial;
            });
            if (!theRightMaterial) {
                console.log("Can't match a material!");
                return;
            }
            //为同一材质下每个表面的每个顶点赋予材质中Kd属性的颜色
            for (const theFace of theFaces.faces) {
                trueIndexNumber = 3 + 3 * (theFace.dataNumber - 3);
                for (var n = 0; n < trueIndexNumber; ++n) {
                    colors.set([theRightMaterial.Kd.x,
                    theRightMaterial.Kd.y,
                    theRightMaterial.Kd.z], dataCount);
                    dataCount += 3;
                }
            }
        }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, allBuffers.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
}

function passVertexIntoBuffer(objFile, gl, allBuffers, indexAmount) {
    let vertices = generateDrawData(objFile, indexAmount, getFullVertexIndices, setVertexData);
    gl.bindBuffer(gl.ARRAY_BUFFER, allBuffers.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

function passTexCoordsIntoBuffer(objFile, gl, allBuffers, indexAmount) {
    let texCoords = generateDrawData(objFile, indexAmount, getFullTexCoordIndices, setTexCoordData);
    gl.bindBuffer(gl.ARRAY_BUFFER, allBuffers.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
}

function passNormalIntoBuffer(objFile, gl, allBuffers, indexAmount) {
    let normals = generateDrawData(objFile, indexAmount, getFullNormalIndices, setNormalData);
    gl.bindBuffer(gl.ARRAY_BUFFER, allBuffers.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
}

function generateDrawData(objFile, indexAmount, getFullIndices, setData) {
    let fullIndices = getFullIndices(objFile);
    let array_drawData = new Array(0);
    for (const theObject of objFile.objects) {
        for (let i = 0; i < indexAmount; ++i) {
            setData(theObject, array_drawData, fullIndices, i);
        }
    }
    let drawData = Float32Array.from(array_drawData);
    return drawData;
}

function setVertexData(theObject, array_vertex, fullVertexIndices, index) {
    array_vertex.push(theObject.vertices[fullVertexIndices[index]].x,
        theObject.vertices[fullVertexIndices[index]].y,
        theObject.vertices[fullVertexIndices[index]].z);
}

function setTexCoordData(theObject, array_texCoord, fullTexCoordIndices, index) {
    array_texCoord.push(theObject.texCoords[fullTexCoordIndices[index]].x,
        theObject.texCoords[fullTexCoordIndices[index]].y);
}

function setNormalData(theObject, array_normal, fullNormalIndices, index) {
    array_normal.push(theObject.normals[fullNormalIndices[index]].x,
        theObject.normals[fullNormalIndices[index]].y,
        theObject.normals[fullNormalIndices[index]].z);
}

function getIndexAmount(objFile) {
    var indexAmount = 0;
    var trueIndexNumber = 0;
    for (const theObject of objFile.objects) {
        for (const theFaces of theObject.facesByMaterial) {
            for (const theFace of theFaces.faces) {
                trueIndexNumber = 3 + 3 * (theFace.dataNumber - 3);
                indexAmount += trueIndexNumber;
            }
        }
    }
    return indexAmount;
}

function getFullVertexIndices(objFile) {
    const fullVertexIndices = generateIndicesByOBJFileViaTriangulation(objFile, convexPolygonTriangulationForVertex);
    return fullVertexIndices;
}

function getFullTexCoordIndices(objFile) {
    const fullTexCoordIndices = generateIndicesByOBJFileViaTriangulation(objFile, convexPolygonTriangulationForTexCoord);
    return fullTexCoordIndices;
}

function getFullNormalIndices(objFile) {
    const fullNormalIndices = generateIndicesByOBJFileViaTriangulation(objFile, convexPolygonTriangulationForNormal);
    return fullNormalIndices;
}

function generateIndicesByOBJFileViaTriangulation(OBJFile, triangulationMethod) {
    let indices = new Array();
    for (const theObject of OBJFile.objects) {
        for (const theFaces of theObject.facesByMaterial) {
            for (const theFace of theFaces.faces) {
                for (let component = 2; component < theFace.dataNumber; ++component) {
                    triangulationMethod(component, theFace, indices);
                }
            }
        }
    }
    return indices;
}

function convexPolygonTriangulationForVertex(component, theFace, a_fullVertexIndices) {
    a_fullVertexIndices.push(theFace.vertexIndex[0] - 1,
        theFace.vertexIndex[component - 1] - 1,
        theFace.vertexIndex[component] - 1);
}

function convexPolygonTriangulationForTexCoord(component, theFace, a_fullTexCoordIndices) {
    a_fullTexCoordIndices.push(theFace.texCoordIndex[0] - 1,
        theFace.texCoordIndex[component - 1] - 1,
        theFace.texCoordIndex[component] - 1);
}

function convexPolygonTriangulationForNormal(component, theFace, a_fullNormalIndices) {
    a_fullNormalIndices.push(theFace.normalIndex[0] - 1,
        theFace.normalIndex[component - 1] - 1,
        theFace.normalIndex[component] - 1);
}

function initGL() {
    var canvas = document.getElementById('canvas');
    var gl = canvas.getContext('webgl');
    initShaders(gl, vshader, fshader);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    return gl;
}

function initModelMat(gl) {
    var modelMat = new Matrix4();
    modelMat.setIdentity();
    passMatrix(gl, modelMat, 'u_modelMat');
    return modelMat;
}

function initViewMat(gl) {
    var u_cameraPosition = gl.getUniformLocation(gl.program, 'u_cameraPosition');
    gl.uniform3f(u_cameraPosition, 0, 0, 3);
    var viewMat = new Matrix4();
    viewMat.setLookAt(0, 0, 3, 0, 0, 0, 0, 1, 0);
    var u_viewMat = gl.getUniformLocation(gl.program, 'u_viewMat');
    gl.uniformMatrix4fv(u_viewMat, false, viewMat.elements);
    return viewMat;
}

function initProjMat(gl) {
    var projMat = new Matrix4();
    projMat.setPerspective(30, 16 / 10, 1, 100);
    var u_projMat = gl.getUniformLocation(gl.program, 'u_projMat');
    gl.uniformMatrix4fv(u_projMat, false, projMat.elements);
    return projMat;
}

function initNormalMat(gl) {
    var normalMat = new Matrix4();
    normalMat.setIdentity();
    passMatrix(gl, normalMat, 'u_normalMat');
    return normalMat;
}

function passMatrix(gl, matrix, uniformName) {
    var u_matrix = gl.getUniformLocation(gl.program, uniformName);
    gl.uniformMatrix4fv(u_matrix, false, matrix.elements);
}

function initLights(gl) {
    initPointLight(gl);
    initAmbientLight(gl);
}

function initPointLight(gl) {
    var u_lightColor = gl.getUniformLocation(gl.program, 'u_lightColor');
    var u_lightPosition = gl.getUniformLocation(gl.program, 'u_lightPosition');
    gl.uniform3f(u_lightColor, 1.0, 1.0, 1.0);
    gl.uniform3f(u_lightPosition, 1, 1, 1);
}

function initAmbientLight(gl) {
    var u_ambient = gl.getUniformLocation(gl.program, 'u_ambient');
    gl.uniform3f(u_ambient, 0.2, 0.2, 0.2);
}

function adjustAngle(event, xangle, yangle) {
    switch (event.keyCode) {
        case KEY_RIGHT:
            xangle += 3.0;
            break;
        case KEY_LEFT:
            xangle -= 3.0;
            break;
        case KEY_UP:
            if (yangle > -90.0)
                yangle -= 3.0;
            break;
        case KEY_DOWN:
            if (yangle < 90.0)
                yangle += 3.0;
            break;
        default:
            break;
    }
    xangle = xangle % 360.0;
    yangle = yangle % 360.0;
    return [xangle, yangle];
}

function displayAngle(xangle, yangle) {
    let xAngleHTML = document.getElementById('x-angle');
    let yAngleHTML = document.getElementById('y-angle');
    xAngleHTML.innerHTML = xangle;
    yAngleHTML.innerHTML = yangle;
}

function drawFrame(obj3d, gl, xangle, yangle) {
    const modelMat = obj3d.modelMat;
    const normalMat = obj3d.normalMat;
    modelMat.setRotate(yangle, 1, 0, 0);
    modelMat.rotate(xangle, 0, 1, 0);

    normalMat.setInverseOf(modelMat);
    normalMat.transpose();

    obj3d.draw(gl);
}


async function main() {
    let gl = initGL();
    const viewMat = initViewMat(gl);
    const projMat = initProjMat(gl);
    initLights(gl);

    const obj3d = new Object3D();
    await obj3d.create(gl);

    let xangle = -24.0;
    let yangle = 30.0;
    displayAngle(xangle, yangle);
    drawFrame(obj3d, gl, xangle, yangle);


    document.onkeydown = function (event) {
        [xangle, yangle] = adjustAngle(event, xangle, yangle);
        displayAngle(xangle, yangle);
        drawFrame(obj3d, gl, xangle, yangle);
    }

    //获取XY角度加减各四个按钮，然后按照键盘改变角度的代码为他们注册按下时的事件函数
    xplusButton = document.getElementById('xPlus');
    yplusButton = document.getElementById('yPlus');
    xminusButton = document.getElementById('xMinus');
    yminusButton = document.getElementById('yMinus');
    xplusButton.onclick = function () {
        xangle += 3.0;
        xangle = xangle % 360.0;
        displayAngle(xangle, yangle);
        drawFrame(obj3d, gl, xangle, yangle);
    }
    xminusButton.onclick = function () {
        xangle -= 3.0;
        xangle = xangle % 360.0;

        displayAngle(xangle, yangle);
        drawFrame(obj3d, gl, xangle, yangle);
    }
    yplusButton.onclick = function () {
        if (yangle > -90.0) {
            yangle -= 3.0;
            yangle = yangle % 360.0;
            displayAngle(xangle, yangle);
            drawFrame(obj3d, gl, xangle, yangle);
        }
    }
    yminusButton.onclick = function () {
        if (yangle < 90.0) {
            yangle += 3.0;
            yangle = yangle % 360.0;
            displayAngle(xangle, yangle);
            drawFrame(obj3d, gl, xangle, yangle);
        }
    }
}
main();