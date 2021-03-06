define([
    'ccc/pvc',
    '../utils',
    '../data-1'
], function(pvc, utils, datas) {
    describe('Atum', function() {
        describe("loading over BarChart", function(){
            var data = utils.loadDataOverBaseChart(datas['cross-tab, category missing on first series']);

            it("should be selected after setSelected", function(){
                var atoms = data.dimensions('series').atoms();

                expect(atoms[0].toString()).toBe("London");
                expect(atoms[1].toString()).toBe("Lisbon");
            });
        });

    });
});