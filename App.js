(function () {
    var Ext = window.Ext4 || window.Ext;

Ext.define('Niks.Apps.listExporter.app', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    integrationHeaders : {
        name : "niks-apps-radial-density"
    },
    
    config: {
        defaultSettings: {
            includeStories: true,
            includeDefects: false,
            includeTasks: false,
            includeTestCases: false,
            usePreliminaryEstimate: true,
            hideArchived: false,
            sizeStoriesByPlanEstimate: false,
            sortSize: false
        }
    },

    WorldViewNode: {
        Name: 'World View',
        dependencies: [],
        local: false,
        record: {
            data: {
                FormattedID: 'R0'
            }
        }
    },

    statics: {
        //Be aware that each thread might kick off more than one activity. Currently, it could do three for a user story.
        MAX_THREAD_COUNT: 32,  //More memory and more network usage the higher you go.
    },

    _defectModel: null,
    _userStoryModel: null,
    _taskModel: null,
    _testCaseModel: null,
    _portfolioItemModels: {},
    _storyStates: [],
    _defectStates: [],
    _taskStates: [],
    _tcStates: [],
    _piStates: [],

    _nodes: [],

    _recordsToProcess: [],
    _runningThreads: [],
    _lastThreadID: 0,

    itemId: 'rallyApp',

    STORE_FETCH_FIELD_LIST:
    [
        'Attachments',
        'Blocked',
        'Children',
        'Defects',
        'DisplayColor',
        'DragAndDropRank',
        'FormattedID',
        'Iteration',
        'LastVerdict',
        'Name',
        'ObjectID',
        'OrderIndex', 
        'Ordinal',
        'Owner',
        'Parent',
        'PercentDoneByStoryCount',
        'PercentDoneByStoryPlanEstimate',
        'PlanEstimate',
        'PortfolioItemType',
        'Predecessors',
        'PredecessorsAndSuccessors',
        'PreliminaryEstimate',
        'Project',
        'Ready',
        'Release',
        'Requirement',  //Needed to find parent of: Defects
        'ScheduleState',
        'State',
        'Successors',
        'Tasks',
        'TestCases',
        'UserStories',
        'WorkProduct',  //Needed =to find parent of: Tasks, TestCases
        'Workspace',
        //Customer specific after here. Delete as appropriate
//        'c_ProjectIDOBN',
//        'c_QRWP',
//        'c_ProgressUpdate',
//        'c_RAIDSeverityCriticality',
//        'c_RISKProbabilityLevel',
//        'c_RAIDRequestStatus'   
    ],
EXPORT_FIELD_LIST:
    [
        'Attachments',
        'Name',
        'Owner',
        'PreliminaryEstimate',
        'Parent',
        'Project',
        'PercentDoneByStoryCount',
        'PercentDoneByStoryPlanEstimate',
        'PredecessorsAndSuccessors',
        'State',
        'Milestones',
        //Customer specific after here. Delete as appropriate
//        'c_ProjectIDOBN',
//        'c_QRWP'

    ],

    onSettingsUpdate: function(newSettings) {
//            gApp._loadStoreLocal();
    },

    getSettingsFields: function() {
        var returned = [
            {
                name: 'hideArchived',
                xtype: 'rallycheckboxfield',
                fieldLabel: 'Do not show archived',
                labelALign: 'middle'
            },
            {
                name: 'includeStories',
                xtype: 'rallycheckboxfield',
                fieldLabel: 'Include User Stories in Export',
                labelALign: 'middle'
            },
            {
                name: 'includeDefects',
                xtype: 'rallycheckboxfield',
                fieldLabel: 'Include Defects Stories in Export',
                labelALign: 'middle'
            },
            {
                name: 'includeTasks',
                xtype: 'rallycheckboxfield',
                fieldLabel: 'Include Tasks in Export',
                labelALign: 'middle'
            },
            {
                name: 'includeTestCases',
                xtype: 'rallycheckboxfield',
                fieldLabel: 'Include TestCases in Export',
                labelALign: 'middle'
            }
        ];
        return returned;
    },

    timer: null,
    
    _redrawTree: function() {
        if (gApp.down('#loadingBox')) { gApp.down('#loadingBox').destroy();}
        clearTimeout(gApp.timer);
        if (gApp._nodeTree) {
            _.each(gApp._nodeTree.descendants(),
                function(d) { 
                    if (d.card) {
                        d.card.destroy();
                    }
                }
            );
            d3.select("#tree").remove();
            d3.select("#depsOverlay").remove();
            gApp._nodeTree = null;
        }
        gApp._enterMainApp();
    },

    _enterMainApp: function() {

        //Timer can fire before we retrieve anything
        if (!gApp._nodes.length) { return;}

       //Get all the nodes and the "Unknown" parent virtual nodes
       var nodetree = gApp._createTree(gApp._nodes);
       gApp._nodeTree = nodetree;

        gApp._refreshTree(viewBoxSize);    //Need to redraw if things are added
    },

    _getUserStoryModel: function() {
        var deferred = Ext.create('Deft.Deferred');
        Rally.data.ModelFactory.getModel({
            type: 'UserStory',
            context: {
                workspace: gApp.getContext().getWorkspace()
            },
            success: function(model) {
                gApp._userStoryModel = model;
                _.each(model.getField('ScheduleState').attributeDefinition.AllowedValues, function(value,idx) {
                    gApp._storyStates.push( { name: value.StringValue, value : idx});
                });
                deferred.resolve(model);
            },
            failure: function(e) {
                deferred.reject(null);
            }
        });
        return deferred.promise;
    },

    _getDefectModel: function() {
        var deferred = Ext.create('Deft.Deferred');
        Rally.data.ModelFactory.getModel({
            type: 'Defect',
            context: {
                workspace: gApp.getContext().getWorkspace()
            },
            success: function(model) {
                gApp._defectModel = model;
                _.each(model.getField('ScheduleState').attributeDefinition.AllowedValues, function(value,idx) {
                    gApp._defectStates.push( { name: value.StringValue, value : idx});
                });
                deferred.resolve(model);
            },
            failure: function(e) {
                deferred.reject(null);
            }
        });
        return deferred.promise;
    },

    _getTaskModel: function() {
        var deferred = Ext.create('Deft.Deferred');
        Rally.data.ModelFactory.getModel({
            type: 'Task',
            context: {
                workspace: gApp.getContext().getWorkspace()
            },
            success: function(model) {
                gApp._taskModel = model;
                _.each(model.getField('State').attributeDefinition.AllowedValues, function(value,idx) {
                    gApp._taskStates.push( { name: value.StringValue, value : idx});
            });
                deferred.resolve(model);
            },
            failure: function(e) {
                deferred.reject(null);
            }
        });
        return deferred.promise;
    },

    _getTestCaseModel: function() {
        var deferred = Ext.create('Deft.Deferred');
        Rally.data.ModelFactory.getModel({
            type: 'TestCase',
            context: {
                workspace: gApp.getContext().getWorkspace()
            },
            success: function(model) {
                gApp._testCaseModel = model;
                _.each(model.getField('LastVerdict').attributeDefinition.AllowedValues, function(value,idx) {
                    gApp._tcStates.push( { name: value.StringValue, value : idx});
                });
                deferred.resolve(model);
            },
            failure: function(e) {
                deferred.reject(null);
            }
        });
        return deferred.promise;
    },

    //Entry point for export
    _exportCSV: function(rs) {

            Rally.data.ModelFactory.getModel({
                type: 'TestCase',
                context: {
                    workspace: gApp.getContext().getWorkspace()
                },
                success: function(model) {
                    gApp._testCaseModel = model;
                    _.each(model.getField('LastVerdict').attributeDefinition.AllowedValues, function(value,idx) {
                        gApp._tcStates.push( { name: value.StringValue, value : idx});
                    });
                }
            });

    },

    _loadStoreLocal: function() {
        var ptype = gApp.down('#piType');
        Ext.create('Rally.data.wsapi.Store', {
            model: 'portfolioitem/' + ptype.rawValue.toLowerCase(),
            autoLoad: true,
            fetch: gApp.STORE_FETCH_FIELD_LIST,
            pageSize: 2000,
            limit: Infinity,
            sorters: [
                {
                    property: 'DragAndDropRank',
                    direction: 'ASC'
                }
            ],
            listeners: {
                load: function( store, records, success) {
                    gApp._nodes = [ gApp.WorldViewNode ];
                    if (records.length > 0) {
                        gApp.setLoading("Loading artefacts....");
                        gApp._getArtifacts(records);
                    }
                    else {
                        Rally.ui.notify.Notifier.show({message: 'No Artefacts to fetch'});
                    }
                }
            }
        });
    },

    launch: function() {
        gApp = this;
                //Add any useful selectors into this container 
        //Choose a point when all are 'ready' to jump off into the rest of the app
        this.add ({
            xtype: 'container',
            itemId: 'displayBox',
            items: [
                { 
                    xtype: 'container',
                    itemId: 'headerBox',
                    layout: 'hbox',
                    items: [
                        {
                            xtype:  'rallyportfolioitemtypecombobox',
                            itemId: 'piType',
                            fieldLabel: 'Choose Portfolio Type :',
                            labelWidth: 150,
                            allowClear: true,
                            margin: '5 0 5 20',
                            storeConfig: {
                                fetch: ['DisplayName', 'ElementName','Ordinal','Name','TypePath', 'Attributes'],
                                listeners: {
                                    load: function(store) {
                                        gApp._typeStore = store;
                                    }
                                }
                            },
                            listeners: {
                                select: function(box) {
                                    gApp._piModelsValid(box.getRecord());
                                },
                                scope: gApp
                            }
                        }
                    ]
                }
            ]
        });
    },

    _piModelsValid: function(record) {
        var modelNames = ((typeof record.get('_type')) === 'string')? [record.get('TypePath').toLowerCase()]: ['hierarchicalrequirement', 'defect'];

        Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
            models: modelNames,
            enableHierarchy: true,
            remoteSort: true,
            fetch: ['FormattedID', 'Name']
        }).then({
            success: function(store) { gApp._addGridboard(store, modelNames);},
            scope: this
        });
    },

    _addGridboard: function(store, modelNames) {
        this.gridboard = gApp.down('#displayBox').add({
            xtype: 'rallygridboard',
            context: gApp.getContext(),
            modelNames: modelNames,
            toggleState: 'grid',
            plugins: [
                'rallygridboardaddnew',
                {
                    ptype: 'rallygridboardinlinefiltercontrol',
                    inlineFilterButtonConfig: {
                        stateful: true,
                        stateId: gApp.getContext().getScopedStateId('filters-1'),
                        modelNames: modelNames,
                        inlineFilterPanelConfig: {
                            quickFilterPanelConfig: {
                                whiteListFields: [
                                   'Tags',
                                   'Milestones'
                                ],
                                defaultFields: [
                                    'ArtifactSearch',
                                    'Owner',
                                    'ModelType',
                                    'Milestones'
                                ]
                            }
                        }
                    }
                },
                {
                    ptype: 'rallygridboardfieldpicker',
                    headerPosition: 'left',
                    modelNames: modelNames
                    //stateful: true,
                    //stateId: this.getContext().getScopedStateId('columns-example')
                },
                {
                    ptype: 'rallygridboardactionsmenu',
                    menuItems: gApp._getExportMenuItems(),
                    buttonConfig: {
                        iconCls: 'icon-export'
                    }
                }
            ],
            cardBoardConfig: {
                attribute: 'ScheduleState'
            },
            gridConfig: {
                store: store,
                columnCfgs: [
                    'Name'
                ]
            },
//            height: gApp.getHeight()
            height: gApp.getHeight() - gApp.down('#headerBox').getHeight()
    });
    },
    _getExportMenuItems: function() {
        return [
            {
                text: 'Export to CSV',
                handler: gApp._getGridArtifacts,
                scope: gApp
            }
        ];
    },

    _findIdInTree: function(id) {
        return _.find(gApp._nodeTree.descendants(), function(node) {
            return node.data.record.data.FormattedID === id;
        });
    },
    
    _threadCreate: function() {

        var workerScript = worker.toString();
        //Strip head and tail
        workerScript = workerScript.substring(workerScript.indexOf("{") + 1, workerScript.lastIndexOf("}"));
        var workerBlob = new Blob([workerScript],
            {
                type: "application/javascript"
            });
        var wrkr = new Worker(URL.createObjectURL(workerBlob));
        var thread = {
            lastCommand: '',
            worker: wrkr,
            state: 'Initiate',
            id: ++gApp._lastThreadID,
        };
        
        gApp._runningThreads.push(thread);
        wrkr.onmessage = gApp._threadMessage;
        gApp._giveToThread(thread, {
            command: 'initialise',
            id: thread.id,
            fields: gApp.STORE_FETCH_FIELD_LIST.concat([gApp._getModelFromOrd(0).split("/").pop()])
        });
    },

    _checkThreadState: function(thread) {
        return thread.state;
    },

    _wakeThread: function(thread) {
        if ( gApp._checkThreadState(thread) === 'Asleep') {  
            thread.lastMessage = 'wake';
            thread.worker.postMessage({
                command: thread.lastMessage
            });
        }
    },

    _checkThreadActivity: function() {
        while (gApp._runningThreads.length < gApp.self.MAX_THREAD_COUNT) {
            //Check the required amount of threads are still running
            gApp._threadCreate();
        }
        _.each(gApp._runningThreads, function(thread) {
            if ((gApp._recordsToProcess.length > 0) && (thread.state === 'Asleep')) {
                //Keep asking to process until their is somethng that needs doing
                gApp._processRecord(thread,gApp._recordsToProcess.pop());
            }
        });

    },

    _giveToThread: function(thread, msg){
        thread.state = 'Busy';
        thread.worker.postMessage(msg);
    },

    _processRecord: function(thread, record) {
        thread.lastCommand = 'readchildren';
        var msg = {
            command: thread.lastCommand,
            objectID: record.get('ObjectID'),
            hasChildren: (record.hasField('Children') && (record.get('Children').Count > 0)) ?
                Rally.util.Ref.getUrl(record.get('Children')._ref):null,
            hasDefects: (gApp.getSetting('includeDefects') && record.hasField('Defects') && (record.get('Defects').Count > 0) ) ?
                Rally.util.Ref.getUrl(record.get('Defects')._ref):null,
            hasStories: (gApp.getSetting('includeStories') && record.hasField('UserStories') && (record.get('UserStories').Count > 0)) ?
                Rally.util.Ref.getUrl(record.get('UserStories')._ref):null,
            hasTasks: (gApp.getSetting('includeTasks') && record.hasField('Tasks') && (record.get('Tasks').Count > 0) ) ?
                Rally.util.Ref.getUrl(record.get('Tasks')._ref):null,
            hasTestCases:(gApp.getSetting('includeTestCases') && record.hasField('TestCases')  && (record.get('TestCases').Count > 0) ) ?
                Rally.util.Ref.getUrl(record.get('TestCases')._ref):null,

        };
        gApp._giveToThread(thread, msg);    //Send a wakeup message with an item
    },

    _getGridArtifacts: function() {
debugger;
        gApp._getArtifacts(gApp.down('rallygridboard').getGridOrBoard().getStore().getTopLevelNodes());
    },

    _getArtifacts: function(records) {
        gApp._nodes = gApp._nodes.concat( gApp._createNodes(records)); 

        _.each(records, function(record) {
            gApp._recordsToProcess.push(record);
        });
        gApp._checkThreadActivity();
    },

    //This is in the context of the worker thread even though the code is here
    _threadMessage: function(msg) {
        //Records come back as raw info. We need to make proper Rally.data.WSAPI.Store records out of them
        if (msg.data.reply === 'Data') {
            var records = [];

            _.each(msg.data.records, function(item) {
                switch (item._type) {
                    case 'HierarchicalRequirement' : {
                        records.push(Ext.create(gApp._userStoryModel, item));
                        break;
                    }
                    case 'Defect' : {
                        records.push(Ext.create(gApp._defectModel, item));
                        break;
                    }
                    case 'Task' : {
                        records.push(Ext.create(gApp._taskModel, item));
                        break;
                    }
                    case 'TestCase' : {
                        records.push(Ext.create(gApp._testCaseModel, item));
                        break;
                    }
                    default: {
                        //Portfolio Item
                        records.push(Ext.create(gApp._portfolioItemModels[item._type.split('/').pop()], item));
                        break;
                    }
                }
            });
            gApp._getArtifacts(records);

            
        }
        var thread = _.find(gApp._runningThreads, { id: msg.data.id});
        thread.state = 'Asleep';
        //Farm out more if needed
        if (gApp._recordsToProcess.length > 0) {
            //We have some, so give to a thread
            gApp._processRecord(thread, gApp._recordsToProcess.pop());
        }

        if ( gApp._allThreadsIdle()) {
            gApp.setLoading("Exporting CSV....");
            gApp._exportCSV();
        }
    },

    _allThreadsIdle: function() {
        return _.every(gApp._runningThreads, function(thread) {
            return thread.state === 'Asleep';
        });
    },

    _nodeTree: null,

    _refreshTree: function(viewBoxSize){
 
        //Might want to change this...
        gApp._nodeTree.sum( function(d) {
            var retval = 0;
            if (d.record.data._ref) {
                if (d.record.isPortfolioItem()){
                    if ( gApp.getSetting('usePreliminaryEstimate')){
                        retval = d.record.get('PreliminaryEstimateValue');
                    } else {
                        retval = d.record.get('LeafStoryCount'); 
                    }
                }else {
                        //We are a User Story here
                        if ( gApp.getSetting('sizeStoriesByPlanEstimate')){
                            retval = d.record.get('PlanEstimate');
                        }else {
                            retval = d.record.get('DirectChildrenCount'); 
                        }
                    }
                }
            return retval ? retval : 1;
        });

        if ( gApp.getSetting('sortSize') ){
            gApp._nodeTree.sort(function(a,b) { return b.value - a.value; });
        }

        var nodetree = partition(gApp._nodeTree);
        var tree = d3.select('#tree');

        var nodes = tree.selectAll("node")
                .data(nodetree.descendants())
                .enter();

        gApp.setLoading(false);

    },

    _createNodes: function(data) {
        //These need to be sorted into a hierarchy based on what we have. We are going to add 'other' nodes later
        var nodes = [];
        //Push them into an array we can reconfigure
        _.each(data, function(record) {
            var localNode = (gApp.getContext().getProjectRef() === record.get('Project')._ref);
            nodes.push({'Name': record.get('FormattedID'), 'record': record, 'local': localNode, 'dependencies': []});
        });
        return nodes;
    },

    _findNodeByRef: function(ref) {
        return _.find(gApp._nodes, function(node) { return node.record.data._ref === ref;}); //Hope to god there is only one found....
    },

    _findParentType: function(record) {
        //The only source of truth for the hierachy of types is the typeStore using 'Ordinal'
        var ord = null;
        for ( var i = 0;  i < gApp._typeStore.totalCount; i++ )
        {
            if (record.data._type === gApp._typeStore.data.items[i].get('TypePath').toLowerCase()) {
                ord = gApp._typeStore.data.items[i].get('Ordinal');
                break;
            }
        }
        ord += 1;   //We want the next one up, if beyond the list, set type to root
        //If we fail this, then this code is wrong!
        if ( i >= gApp._typeStore.totalCount) {
            return null;
        }
        var typeRecord =  _.find(  gApp._typeStore.data.items, function(type) { return type.get('Ordinal') === ord;});
        return (typeRecord && typeRecord.get('TypePath').toLowerCase());
    },
    _findNodeById: function(nodes, id) {
        return _.find(nodes, function(node) {
            return node.record.data.FormattedID === id;
        });
    },
        //Routines to manipulate the types

     _getTypeList: function(highestOrdinal) {
        var piModels = [];
        _.each(gApp._typeStore.data.items, function(type) {
            //Only push types below that selected
            if (type.data.Ordinal <= (highestOrdinal ? highestOrdinal: 0) ) {
                piModels.push({ 'type': type.data.TypePath.toLowerCase(), 'Name': type.data.Name, 'ref': type.data._ref, 'Ordinal': type.data.Ordinal});
            }
        });
        return piModels;
    },

    _highestOrdinal: function() {
        return _.max(gApp._typeStore.data.items, function(type) { return type.get('Ordinal'); }).get('Ordinal');
    },
    _getModelFromOrd: function(number){
        var model = null;
        _.each(gApp._typeStore.data.items, function(type) { if (number === type.get('Ordinal')) { model = type; } });
        return model && model.get('TypePath');
    },

    _getOrdFromModel: function(modelName){
        var model = null;
        _.each(gApp._typeStore.data.items, function(type) {
            if (modelName === type.get('TypePath').toLowerCase()) {
                model = type.get('Ordinal');
            }
        });
        return model;
    },

    _findParentNode: function(nodes, child){
        var record = child.record;
        if (record.data.FormattedID === 'R0') { return null; }

        //Nicely inconsistent in that the 'field' representing a parent of a user story has the name the same as the type
        // of the first level of the type hierarchy.
        var parentField = gApp._getModelFromOrd(0).split("/").pop();
        var parent = null;
        if (record.isPortfolioItem()) {
            parent = record.data.Parent;
        }
        else if (record.isUserStory()) {
            if (record.data.Parent) { parent = record.data.Parent;}
            else {
                parent = record.data[parentField];
            }
        }
        else if (record.isTask()) {
            parent = record.data.WorkProduct;
        }
        else if (record.isDefect()) {
            parent = record.data.Requirement;
        }
        else if (record.isTestCase()) {
            parent = record.data.WorkProduct;
        }
        var pParent = null;
        if (parent ){
            //Check if parent already in the node list. If so, make this one a child of that one
            //Will return a parent, or null if not found
            pParent = gApp._findNodeByRef( parent._ref);
        }
        else {
            //Here, there is no parent set, so attach to the 'null' parent.
            var pt = gApp._findParentType(record);
            //If we are at the top, we will allow d3 to make a root node by returning null
            //If we have a parent type, we will try to return the null parent for this type.
            if (pt) {
                var parentName = '/' + pt + '/null';
                pParent = gApp._findNodeByRef(parentName);
            }
        }
        //If the record is a type at the top level, then we must return something to indicate 'root'
        return pParent?pParent: gApp._findNodeById(nodes, 'R0');
    },

    _createTree: function (nodes) {
        //Try to use d3.stratify to create nodet
        var nodetree = d3.stratify()
                    .id( function(d) {
                        var retval = (d.record && d.record.data.FormattedID) || null; //No record is an error in the code, try to barf somewhere if that is the case
                        return retval;
                    })
                    .parentId( function(d) {
                        var pParent = gApp._findParentNode(nodes, d);
                        return (pParent && pParent.record && pParent.record.data.FormattedID); })
                    (nodes);

        nodetree.sum( function(d) { return d.Attachments? d.Attachments.Size : 0; });
        nodetree.each( function(d) { 
            d.ChildAttachments = {};
            d.ChildAttachments.Size = d.value;
        });
        nodetree.sum( function(d) { return d.Attachments? d.Attachments.Count : 0; });
        nodetree.each( function(d) { 
            d.ChildAttachments.Count = d.value;
        });
        console.log("Created Tree: ", nodetree);
        return nodetree;
    },
});
}());