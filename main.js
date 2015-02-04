/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
    "use strict";

    var AppInit = brackets.getModule("utils/AppInit");
    var WorkspaceManager = brackets.getModule("view/WorkspaceManager");
    var MainViewManager = brackets.getModule("view/MainViewManager");
    var EditorManager = brackets.getModule("editor/EditorManager");
    var Editor = brackets.getModule("editor/Editor");
    var ExtensionUtils = brackets.getModule("utils/ExtensionUtils");
    var CommandManager = brackets.getModule("command/CommandManager");
    var Menus = brackets.getModule("command/Menus");
    var Dialogs = brackets.getModule("widgets/Dialogs");
    var PreferencesManager = brackets.getModule("preferences/PreferencesManager");
    var Strings = brackets.getModule("strings");
    
    var prefs = PreferencesManager.getExtensionPrefs("maupin.cursor");
    var $template = $(Mustache.render(require("text!html/cursor-settings.html"), {"Strings": Strings}));
    var commandId = "maupin.cursor.openSettings";
    var editors = [];
    var cssNode = null;
    var viewMenu;
    var viewMenuCommands;
    var currentEditor = EditorManager.getCurrentFullEditor();
    var addChar = false;
    
    // NOTE: access to ._codeMirror may disappear in future releases of Brackets
    // discussion here:
    // https://github.com/adobe/brackets/issues/8751
    // without access to the codeMirror object, this extension will break

    function refreshCursorOptions(editor) {
        
        var width = editor._codeMirror.defaultCharWidth();
        
        var cursorStyle = prefs.get("cursorStyle");
        var cursorColor = prefs.get("cursorColor");
        var textColor = prefs.get("textColor");
        var blinkRate = prefs.get("blinkRate");
        var css;
        
        addChar = cursorStyle === 'block';
        
        if (cursorStyle === 'block') {
            css = "#editor-holder .CodeMirror-cursor {border-left: none !important;width: " + width + "px !important;background-color: " + cursorColor + " !important;color: " + textColor + " !important;}";
        } else if (cursorStyle === 'horizontal') {
            css = "#editor-holder .CodeMirror-cursor {border-left: none !important;width: " + width + "px !important;border-bottom: 1px solid " + cursorColor + " !important;}";
        } else if (cursorStyle === 'vertical') {
            css = "#editor-holder .CodeMirror-cursor {width: " + width + "px !important;border-left: 1px solid " + cursorColor + " !important;}";
        }

        if (cssNode) {
            cssNode.parentNode.removeChild(cssNode);
        }
        cssNode = ExtensionUtils.addEmbeddedStyleSheet(css);
        
        if (blinkRate || blinkRate === 0) {
            editor._codeMirror.setOption('cursorBlinkRate', blinkRate);
        }
        
    }
    
    function showDialog() {
        var d = Dialogs.showModalDialogUsingTemplate($template, true);
        var dialog = d.getElement();
        var cursor = $('.CodeMirror-cursor');
        var currentColor = cursor.css('border-left-color');
        
        function ghostTextColorGroup() {
            if (dialog.find('#cursorStyle').val() === 'block') {
                dialog.find('#textColorGroup').css({opacity: '1'}).find('input').attr('disabled', false);
            } else {
                dialog.find('#textColorGroup').css({opacity: '.3'}).find('input').attr('disabled', true);
            }
        }
        
        dialog.find('#cursorStyle').val(prefs.get("cursorStyle") || 'vertical');
        dialog.find('#cursorColor').val(prefs.get("cursorColor") || currentColor);
        dialog.find('#textColor').val(prefs.get("textColor") || 'transparent');
        dialog.find('#blinkRate').val(prefs.get("blinkRate") || currentEditor._codeMirror.getOption('cursorBlinkRate'));
        dialog.find('#cursorStyle').change(ghostTextColorGroup);
        
        ghostTextColorGroup();
        
        d.done(function (buttonId) {
            var blinkRate;
            if (buttonId === 'done') {
                prefs.set("cursorStyle", dialog.find('#cursorStyle').val());
                prefs.set("cursorColor", dialog.find('#cursorColor').val());
                prefs.set("textColor", dialog.find('#textColor').val());
                blinkRate = parseInt(dialog.find('#blinkRate').val(), 10) || 0;
                if (blinkRate < 0) {
                    blinkRate = 0;
                }
                prefs.set("blinkRate", blinkRate);
                prefs.save();
                refreshCursorOptions(currentEditor);
            }
            EditorManager.getCurrentFullEditor()._codeMirror.refresh();
        });
    }

    function updateCursor(editor) {
        setTimeout(function () {
            // CodeMirror continually empties the cursor div on any activity
            // so we update on the next tick.
            var document = editor.document;
            var selections = editor.getSelections();
            var cursorElements = window.document.getElementsByClassName("CodeMirror-cursor");
            var chars = [];
            var cursors = [];
            var i;
            selections.forEach(function (selection) {
                var startPos = selection.start;
                var endPos = {line: startPos.line, ch: startPos.ch + 1};
                chars.push(document.getRange(startPos, endPos));
            });
            for (i = cursorElements.length - 1; i >= 0; i--) {
                cursors.push(cursorElements[i]);
            }
            cursors.sort(function (c1, c2) {
                // ensure that the right chars go into the right cursors
                var $c1 = $(c1);
                var $c2 = $(c2);
                if ($c1.offset().top < $c2.offset().top && $c1.offset().left < $c2.offset().left) {
                    return -1;
                } else {
                    return 1;
                }
            });
            if (addChar) {
                cursors.forEach(function (cursor, i) {
                    if (chars[i]) {
                        cursor.innerHTML = chars[i];
                    }
                });
            }
        }, 1);
    }
    
    function cursorActivityHandler(event) {
        var editor = event.target;
        updateCursor(editor);
    }
    
    function registerEditor(editor) {
        var $editor = $(editor);
        // CodeMirror will refill it.  We need to
        // empty it so ...
        $('.CodeMirror-cursors').empty();
        
        if (editors.indexOf(editor) === -1) {
            editors.push(editor);
            $editor.on("cursorActivity", cursorActivityHandler);
            $editor.on("scroll", cursorActivityHandler);
            // without a refresh, cursor will be hidden when switching
            // back to a previously active editor
            editor._codeMirror.refresh();
        }
    }
    
    function unregisterEditor(editor) {
        var i;
        var $editor = $(editor);
        for (i = editors.length - 1; i >= 0; i--) {
            if (editors[i] === editor) {
                editors.splice(i, 1);
            }
        }
        $editor.off("cursorActivity", cursorActivityHandler);
        $editor.off("scroll", cursorActivityHandler);
    }
    
    function viewUpdateHandler() {
        var id;
        for (id in editors) {
            if (editors.hasOwnProperty(id)) {
                updateCursor(editors[id]);
            }
        }
    }
    
    function activeEditorChangedHandler(event, focusedEditor, lostEditor) {
        if (lostEditor) {
            unregisterEditor(lostEditor);
        }
        if (focusedEditor) {
            currentEditor = focusedEditor;
            registerEditor(focusedEditor);
            refreshCursorOptions(focusedEditor);
            updateCursor(focusedEditor);
        }
    }
    
    if (currentEditor) {
        editors.push(currentEditor);
    }
    
    CommandManager.register("Cursor...", commandId, showDialog);

    viewMenu = Menus.getMenu(Menus.AppMenuBar.VIEW_MENU);
    
    viewMenuCommands = CommandManager.getAll();
    
    if (viewMenuCommands.indexOf('view.themesOpenSetting') !== -1) {
        viewMenu.addMenuItem(commandId, null, Menus.AFTER, 'view.themesOpenSetting');
    } else {
        viewMenu.addMenuItem(commandId);
    }
    
    AppInit.appReady(function () {
        $(WorkspaceManager).on('workspaceUpdateLayout', viewUpdateHandler);
        $(MainViewManager).on('activePaneChange', viewUpdateHandler);
        $(EditorManager).on('activeEditorChange', activeEditorChangedHandler);
    });

});
