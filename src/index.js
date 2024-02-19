/**
 * Maker Media Tool for the Editor.js
 *
 * @author Adam Patterson
 * @license MIT
 * @see {@link https://github.com/adampatterson/editorjs-media}
 *
 * To developers.
 * To simplify Tool structure, we split it to 4 parts:
 *  1) index.js — main Tool's interface, public API and methods for working with data
 *  2) uploader.js — module that has methods for sending files via AJAX: from device, by URL or File pasting
 *  3) ui.js — module for UI manipulations: render, showing preloader, etc
 *  4) tunes.js — working with Block Tunes: render buttons, handle clicks
 *
 * For debug purposes there is a testing server
 * that can save uploaded files and return a Response {@link UploadResponseFormat}
 *
 *       $ node dev/server.js
 *
 * It will expose 8008 port, so you can pass http://localhost:8008 with the Tools config:
 *
 * gallery: {
 *   class: MakerMedia,
 *   config: {
 *     endpoints: {
 *       byFile: 'http://localhost:8008/uploadFile',
 *     }
 *   },
 * },
 */

/**
 * @typedef {object} MakerMediaDataFile
 * @description Image Gallery Tool's files data format
 * @property {string} url — image URL
 */

/**
 * @typedef {object} MakerMediaData
 * @description Image Tool's input and output data format
 * @property {boolean} style - slider or gallery
 * @property {string} caption — gallery caption
 * @property {MakerMediaDataFile[]} files — Image file data returned from backend
 */

// eslint-disable-next-line
import './index.pcss';
import Ui from './ui';
import Tunes from './tunes';
// import ToolboxIcon from './svg/toolbox.svg';
const ToolboxIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" height="20" viewBox="0 -960 960 960" width="20"><path d="M360-384h384L618-552l-90 120-66-88-102 136Zm-48 144q-29.7 0-50.85-21.15Q240-282.3 240-312v-480q0-29.7 21.15-50.85Q282.3-864 312-864h480q29.7 0 50.85 21.15Q864-821.7 864-792v480q0 29.7-21.15 50.85Q821.7-240 792-240H312Zm0-72h480v-480H312v480ZM168-96q-29.7 0-50.85-21.15Q96-138.3 96-168v-552h72v552h552v72H168Zm144-696v480-480Z"/></svg>';
import Uploader from './uploader';

/**
 * @typedef {object} ImageConfig
 * @description Config supported by Tool
 * @property {object} endpoints - upload endpoints
 * @property {string} endpoints.byFile - upload by file
 * @property {string} field - field name for uploaded image
 * @property {string} types - available mime-types
 * @property {string} captionPlaceholder - placeholder for Caption field
 * @property {object} additionalRequestData - any data to send with requests
 * @property {object} additionalRequestHeaders - allows to pass custom headers with Request
 * @property {string} buttonContent - overrides for Select File button
 * @property {object} [uploader] - optional custom uploader
 * @property {function(File): Promise.<UploadResponseFormat>} [uploader.uploadByFile] - method that upload image by File
 */

/**
 * @typedef {object} UploadResponseFormat
 * @description This format expected from backend on file uploading
 * @property {number} success - 1 for successful uploading, 0 for failure
 * @property {object} file - Object with file data.
 *                           'url' is required,
 *                           also can contain any additional data that will be saved and passed back
 * @property {string} file.url - [Required] image source URL
 */
export default class MakerMedia {
    /**
     * Notify core that read-only mode is supported
     *
     * @returns {boolean}
     */
    static get isReadOnlySupported() {
        return true;
    }

    /**
     * Get Tool toolbox settings
     * icon - Tool icon's SVG
     * title - title to show in toolbox
     *
     * @returns {{icon: string, title: string}}
     */
    static get toolbox() {
        return {
            icon: ToolboxIcon,
            title: 'Media',
        };
    }

    /**
     * @param {object} tool - tool properties got from editor.js
     * @param {MakerMediaData} tool.data - previously saved data
     * @param {ImageConfig} tool.config - user config for Tool
     * @param {object} tool.api - Editor.js API
     * @param {boolean} tool.readOnly - read-only mode flag
     */
    constructor({data, config, api, readOnly}) {
        this.api = api;
        this.readOnly = readOnly;

        /**
         * Tool's initial config
         */
        this.config = {
            endpoints: config.endpoints || '',
            additionalRequestData: config.additionalRequestData || {},
            additionalRequestHeaders: config.additionalRequestHeaders || {},
            field: config.field || 'image',
            types: config.types || 'image/*',
            captionPlaceholder: this.api.i18n.t(config.captionPlaceholder || 'Gallery caption'),
            buttonContent: config.buttonContent || '',
            uploader: config.uploader || undefined,
            actions: config.actions || [],
            maxElementCount: config.maxElementCount || undefined,
        };

        /**
         * Module for file uploading
         */
        this.uploader = new Uploader({
            config: this.config,
        });

        /**
         * Module for working with UI
         */
        this.ui = new Ui({
            api,
            config: this.config,
            onSelectFile: () => {
                let maxElementCount = (this.config.maxElementCount) ? this.config.maxElementCount - this._data.files.length : null;
                this.uploader.uploadSelectedFiles(maxElementCount, {
                    onPreview: (file) => {
                        return this.ui.getPreloader(file);
                    },
                    onUpload: (response, previewElem) => {
                        this.onUpload(response, previewElem);
                    },
                    onError: (error, previewElem) => {
                        this.uploadingFailed(error, previewElem);
                    },
                });
            },
            onDeleteFile: (id) => {
                this.deleteImage(id);
            },
            onMoveFile: (oldId, newId) => {
                this.moveImage(oldId, newId);
            },
            readOnly,
        });

        /**
         * Module for working with tunes
         */
        this.tunes = new Tunes({
            api,
            actions: this.config.actions,
            onChange: (styleName) => this.styleToggled(styleName),
        });

        /**
         * Set saved state
         */
        this._data = {};
        this.data = data;
    }

    /**
     * Renders Block content
     *
     * @public
     *
     * @returns {HTMLDivElement}
     */
    render() {
        return this.ui.render(this.data);
    }

    rendered() {
        this.checkMaxElemCount();

        return this.ui.onRendered();
    }

    /**
     * Validate data: check if Image exists
     *
     * @param {MakerMediaData} savedData — data received after saving
     * @returns {boolean} false if saved data is not correct, otherwise true
     * @public
     */
    validate(savedData) {
        if (!savedData.files || !savedData.files.length) {
            return false;
        }

        return true;
    }

    /**
     * Return Block data
     *
     * @public
     *
     * @returns {MakerMediaData}
     */
    save() {
        const caption = this.ui.nodes.caption;
        // const tuneName = this.ui.nodes.tuneName;

        this._data.caption = caption.innerHTML;
        // this._data.tuneName = tuneName.innerHTML;

        return this.data;
    }

    /**
     * Makes buttons with tunes: add background, add border, stretch image
     *
     * @public
     *
     * @returns {Element}
     */
    renderSettings() {
        return this.tunes.render(this.data);
    }

    /**
     * Set new image file
     *
     * @private
     *
     * @param {MakerMediaDataFile} file - uploaded file data
     */
    appendImage(file) {
        if (file && file.url) {
            if (this.config.maxElementCount && this._data.files.length >= this.config.maxElementCount) {
                return;
            }

            this._data.files.push(file);
            this.ui.appendImage(file);

            this.checkMaxElemCount();
        }
    }

    /**
     * Move image file
     *
     * @private
     *
     * @param {integer} from - target image old index
     * @param {integer} to - target image new index
     */
    moveImage(from, to) {
        if (to >= this._data.files.length) {
            to = this._data.files.length - 1;
        }
        this._data.files.splice(to, 0, this._data.files.splice(from, 1)[0]);
    }

    /**
     * Delete image file
     *
     * @private
     *
     * @param {integer} id - image index
     */
    deleteImage(id) {
        if (this._data.files[id] !== undefined) {
            this._data.files.splice(id, 1);

            this.checkMaxElemCount();
        }
    }

    /**
     * Private methods
     * ̿̿ ̿̿ ̿̿ ̿'̿'\̵͇̿̿\з= ( ▀ ͜͞ʖ▀) =ε/̵͇̿̿/’̿’̿ ̿ ̿̿ ̿̿ ̿̿
     */

    /**
     * Stores all Tool's data
     *
     * @private
     *
     * @param {MakerMediaData} data - data in Image Tool format
     */
    set data(data) {
        this._data.files = [];
        if (data.files) {
            data.files.forEach(file => {
                this.appendImage(file);
            });
        }

        let style = data.style || '';
        this.styleToggled(style);

        this._data.caption = data.caption || '';
        this.ui.fillCaption(this._data.caption);
    }

    /**
     * Return Tool data
     *
     * @private
     *
     * @returns {MakerMediaData}
     */
    get data() {
        return this._data;
    }

    /**
     * File uploading callback
     *
     * @private
     *
     * @param {UploadResponseFormat} response - uploading server response
     * @returns {void}
     */
    onUpload(response, previewElem) {
        this.ui.removePreloader(previewElem);
        if (response.success && response.file) {
            this.appendImage(response.file);
        } else {
            this.uploadingFailed('incorrect response: ' + JSON.stringify(response));
        }
    }

    /**
     * Handle uploader errors
     *
     * @private
     * @param {string} errorText - uploading error text
     * @returns {void}
     */
    uploadingFailed(errorText, previewElem) {
        this.ui.removePreloader(previewElem);

        console.log('Image Tool: uploading failed because of', errorText);

        this.api.notifier.show({
            message: this.api.i18n.t('Couldn’t upload image. Please try another.'),
            style: 'error',
        });
    }

    /**
     * Callback fired when Block Tune is activated
     *
     * @private
     *
     * @param {string} tuneName - tune that has been clicked
     * @returns {void}
     */
    styleToggled(tuneName) {
        if (tuneName === 'gallery') {
            this._data.style = 'gallery';
        } else {
            this._data.style = 'slider';
        }
    }

    checkMaxElemCount() {
        this.ui.updateLimitCounter(this._data.files.length, this.config.maxElementCount);

        if (this.config.maxElementCount && this._data.files.length >= this.config.maxElementCount) {
            this.ui.hideFileButton();
        } else {
            this.ui.showFileButton();
        }
    }
}
