// -*- mode: java; c-basic-offset: 2; -*-
// Copyright © 2013-2016 MIT, All rights reserved
// Released under the Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0
/**
 * @license
 * @fileoverview Field in which mouseover displays flyout-like menu of blocks
 * and mouse click edits the field name.
 * Flydowns are used in App Inventor for displaying get/set blocks for
 *     parameter names and callers for procedure declarations.
 * @author fturbak@wellesley.edu (Lyn Turbak)
 */

'use strict';

import * as Blockly from 'blockly';
import * as Utilities from '../utilities';

// TODO: Maybe make a single importable goog compatibility object
const goog = {
  provide: (_) => {
  },
  require: (_) => {
  },
  inherits: Blockly.utils.object.inherits,
  dom: Blockly.utils.dom,
  userAgent: Blockly.utils.userAgent,
  asserts: {
    assertObject: (_) => {
    },
  },
};

Blockly.utils.addClass = Blockly.utils.dom.addClass;
Blockly.utils.removeClass = Blockly.utils.dom.removeClass;

goog.provide('AI.Blockly.FieldFlydown');

goog.require('Blockly.FieldTextInput');
goog.require('Blockly.Options');

/**
 * Class for a clickable parameter field.
 * @param {string} name The initial parameter name in the field.
 * @param {boolean} isEditable Whether the user is allowed to change the name
 *     of this parameter or not.
 * @param {string=} opt_displayLocation The location to display the flydown at
 *     Either: FieldFlydown.DISPLAY_BELOW,
 *             FieldFlydown.DISPLAY_RIGHT
 *     Defaults to DISPLAY_RIGHT.
 * @param {Function} opt_changeHandler An optional function that is called
 *     to validate any constraints on what the user entered.  Takes the new
 *     text as an argument and returns the accepted text or null to abort
 *     the change. E.g., for an associated getter/setter this could change
 *     references to names in this field.
 * @extends {Blockly.FieldTextInput}
 * @constructor
 */
export const FieldFlydown =
    function(name, isEditable, opt_displayLocation, opt_changeHandler) {
      // This by itself does not control editability
      this.EDITABLE = isEditable;
      // [lyn, 10/27/13] Make flydown direction an instance variable
      this.displayLocation = opt_displayLocation ||
          FieldFlydown.DISPLAY_RIGHT;

      FieldFlydown.superClass_.constructor.call(
          this, name, opt_changeHandler);
    };
Blockly.utils.object.inherits(FieldFlydown, Blockly.FieldTextInput);

/**
 * Milliseconds to wait before showing flydown after mouseover event on flydown
 * field.
 * @type {number}
 * @const
 */
FieldFlydown.timeout = 500;

/**
 * Process ID for timer event to show flydown (scheduled by mouseover event).
 * @type {number}
 * @const
 */
FieldFlydown.showPid_ = 0;

/**
 * Which instance of FieldFlydown (or a subclass) is an open flydown attached
 * to?
 * @type {FieldFlydown}
 * @private
 */
FieldFlydown.openFieldFlydown_ = null;

// These control the positions of the flydown.
FieldFlydown.DISPLAY_BELOW = 'BELOW';
FieldFlydown.DISPLAY_RIGHT = 'RIGHT';
FieldFlydown.DISPLAY_LOCATION = FieldFlydown.DISPLAY_BELOW;

/**
 * Default CSS class name for the field itself.
 * @type {string}
 * @const
 */
FieldFlydown.prototype.fieldCSSClassName = 'blocklyFieldFlydownField';

/**
 * Default CSS class name for the flydown that flies down from the field.
 * @type {string}
 * @const
 */
FieldFlydown.prototype.flyoutCSSClassName =
    'blocklyFieldFlydownFlydown';

// Override FieldTextInput's showEditor_ so it's only called for EDITABLE field.
FieldFlydown.prototype.showEditor_ = function() {
  if (!this.EDITABLE) {
    return;
  }
  if (FieldFlydown.showPid_) { // cancel a pending flydown for editing
    clearTimeout(FieldFlydown.showPid_);
    FieldFlydown.showPid_ = 0;
    Blockly.hideChaff();
  }
  FieldFlydown.superClass_.showEditor_.call(this);
};

FieldFlydown.prototype.init = function(block) {
  FieldFlydown.superClass_.init.call(this, block);

  // Remove inherited field css classes ...
  Blockly.utils.removeClass(/** @type {!Element} */ (this.fieldGroup_),
      'blocklyEditableText');
  Blockly.utils.removeClass(/** @type {!Element} */ (this.fieldGroup_),
      'blocklyNoNEditableText');
  // ... and add new ones, so that look and feel of flyout fields can be
  // customized
  Blockly.utils.addClass(/** @type {!Element} */ (this.fieldGroup_),
      this.fieldCSSClassName);

  this.mouseOverWrapper_ =
      Blockly.bindEvent_(this.fieldGroup_, 'mouseover', this,
          this.onMouseOver_);
  this.mouseOutWrapper_ =
      Blockly.bindEvent_(this.fieldGroup_, 'mouseout', this, this.onMouseOut_);
};

FieldFlydown.prototype.onMouseOver_ = function(e) {
  // [lyn, 10/22/13] No flydowns in a flyout!
  if (!this.sourceBlock_.isInFlyout && FieldFlydown.showPid_ == 0) {
    FieldFlydown.showPid_ =
        window.setTimeout(this.showFlydownMaker_(),
            FieldFlydown.timeout);
  }
  // This event has been handled.  No need to bubble up to the document.
  e.stopPropagation();
};

FieldFlydown.prototype.onMouseOut_ = function(e) {
  // Clear any pending timer event to show flydown
  window.clearTimeout(FieldFlydown.showPid_);
  FieldFlydown.showPid_ = 0;
  e.stopPropagation();
};

/**
 * Returns a thunk that creates a Flydown block of the getter and setter blocks
 * for receiver field.
 *  @return A thunk (zero-parameter function).
 */
FieldFlydown.prototype.showFlydownMaker_ = function() {
  // Name receiver in variable so can close over this variable in returned thunk
  const field = this;
  return function() {
    if (FieldFlydown.showPid_ !== 0 &&
        !field.getSourceBlock().workspace.isDragging() &&
        !this.htmlInput_) {
      try {
        field.showFlydown_();
      } catch (e) {
        console.error('Failed to show flydown', e);
      }
    }
    FieldFlydown.showPid_ = 0;
  };
};

/**
 * Shows the blocks generated by flydownBlocksXML_ in the flydown. Xml should be
 * wrapped in <xml> tags.
 */
FieldFlydown.prototype.showFlydown_ = function() {
  Blockly.hideChaff();
  const flydown = Blockly.getMainWorkspace().getFlydown();

  // Add flydown to top-level svg, *not* to main workspace svg
  // This is essential for correct positioning of flydown via translation
  // (If it's in workspace svg, it will be additionally translated by
  //  workspace svg translation relative to Blockly.svg.)
  Blockly.getMainWorkspace().getParentSvg().appendChild(flydown.svgGroup_);

  // Adjust scale for current zoom level
  const scale = flydown.targetWorkspace.scale;
  flydown.workspace_.setScale(scale);

  flydown.setCSSClass(this.flyoutCSSClassName);

  const blocksXMLText = this.flydownBlocksXML_();
  const blocksDom = Blockly.Xml.textToDom(blocksXMLText);
  // [lyn, 11/10/13] Use goog.dom.getChildren rather than .children or
  //    .childNodes to make this code work across browsers.
  const blocksXMLList = Utilities.getChildren(blocksDom);

  const xy = Blockly.getMainWorkspace().getSvgXY(this.borderRect_);
  const borderBBox = this.borderRect_.getBBox();
  if (this.displayLocation === FieldFlydown.DISPLAY_BELOW) {
    xy.y += borderBBox.height * scale;
  } else { // Display right.
    xy.x += borderBBox.width * scale;
  }

  // Set the flydown's current field.  Note that this is subtly differnt than
  // FieldFlydown.openFieldFlydown_ because the latter might get reset
  // by an iterim hiding of the field and not get set again by an interim call
  // to show().
  flydown.field_ = this;
  flydown.showAt(blocksXMLList, xy.x, xy.y);
  FieldFlydown.openFieldFlydown_ = this;
};

/**
 * Hide the flydown menu and squash any timer-scheduled flyout creation.
 */
FieldFlydown.hide = function() {
  // Clear any pending timer event to show flydown.
  window.clearTimeout(FieldFlydown.showPid_);
  // Hide any displayed flydown.
  const flydown = Blockly.getMainWorkspace().getFlydown();
  if (flydown) {
    flydown.hide();
  }
};


/**
 * Calls the validation function for this field, as well as all the validation
 * function for the field's class and its parents.
 * @param {Blockly.Field} field The field to validate.
 * @param {string} text Proposed text.
 * @return {?string} Revised text, or null if invalid.
 */
function callAllValidators(field, text) {
  const classResult = field.doClassValidation_(text);
  if (classResult === null) {
    // Class validator rejects value.  Game over.
    return null;
  } else if (classResult !== undefined) {
    text = classResult;
  }
  const userValidator = field.getValidator();
  if (userValidator) {
    const userResult = userValidator.call(field, text);
    if (userResult === null) {
      // User validator rejects value.  Game over.
      return null;
    } else if (userResult !== undefined) {
      text = userResult;
    }
  }
  return text;
}

// TODO: Changing how validators work is not very future proof.
// Override Blockly's behavior; they call the validator after setting the text,
// which is incompatible with how our validators work (we expect to be called
// before the change since in order to find the old references to be renamed).
FieldFlydown.prototype.onHtmlInputChange_ = function(e) {
  goog.asserts.assertObject(this.htmlInput_);
  const htmlInput = this.htmlInput_;
  const text = htmlInput.value;
  if (text !== htmlInput.oldValue_) {
    htmlInput.oldValue_ = text;
    let valid = true;
    if (this.sourceBlock_) {
      valid = callAllValidators(this, htmlInput.value);
    }
    if (valid === null) {
      Blockly.utils.addClass(htmlInput, 'blocklyInvalidInput');
    } else {
      Blockly.utils.removeClass(htmlInput, 'blocklyInvalidInput');
      this.doValueUpdate_(valid);
    }
  } else if (goog.userAgent.WEBKIT) {
    // Cursor key.  Render the source block to show the caret moving.
    // Chrome only (version 26, OS X).
    this.sourceBlock_.render();
  }

  // We need all of the following to cause the field to resize!
  this.textContent_.nodeValue = text;
  this.forceRerender();
  this.resizeEditor_();

  Blockly.svgResize(this.sourceBlock_.workspace);
};

/**
 * Close the flydown and dispose of all UI.
 */
FieldFlydown.prototype.dispose = function() {
  if (FieldFlydown.openFieldFlydown_ == this) {
    FieldFlydown.hide();
  }
  // Call parent's destructor.
  Blockly.FieldTextInput.prototype.dispose.call(this);
};

/**
 * Constructs a FieldFlydown from a JSON arg object.
 * @param {!Object} options A JSON object with options.
 * @return {FieldFlydown} The new field instance.
 * @package
 * @nocollapse
 */
FieldFlydown.fromJson = function(options) {
  const name = Blockly.utils.replaceMessageReferences(options['name']);
  return new FieldFlydown(name, options['is_editable']);
};

Blockly.fieldRegistry.register('field_flydown', FieldFlydown);
